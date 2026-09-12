import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createMediaOperationGroup } from './media-operations.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from './media-read-memory.ts';

const first = {
  id: 'media-first',
  visitId: 'visit-a',
  itemId: 'item-a',
  objectKey: 'visits/visit-a/media-first',
  originalFilename: 'first.jpg',
  contentType: 'image/jpeg',
  byteSize: 11,
  contentSha256: 'hash-first',
  caption: 'First',
  displayOrder: 0,
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
};

const second = {
  ...first,
  id: 'media-second',
  objectKey: 'visits/visit-a/media-second',
  originalFilename: 'second.jpg',
  displayOrder: 1,
  createdAt: '2026-09-10T08:01:00.000Z',
  updatedAt: '2026-09-10T08:01:00.000Z',
};

const otherVisit = {
  ...first,
  id: 'media-other',
  visitId: 'visit-b',
  objectKey: 'visits/visit-b/media-other',
  itemId: 'item-a',
  originalFilename: 'other.jpg',
  createdAt: '2026-09-09T08:00:00.000Z',
  updatedAt: '2026-09-09T08:00:00.000Z',
};

test('VisitMedia list filters by Visit and preserves visit/order/creation ordering', async () => {
  const state = new InMemoryVisitMediaState([second, otherVisit, first]);
  const application = createAtlasApplication(
    createMediaOperationGroup(state, new InMemoryMediaObjectStore()),
  );

  const result = await application.execute({
    key: 'media.list',
    input: { visitId: 'visit-a' },
  });

  assert.deepEqual(result, {
    ok: true,
    value: [toPublicRecord(first), toPublicRecord(second)],
  });

  assert.deepEqual(
    await application.execute({
      key: 'media.list',
      input: { itemId: 'item-a' },
    }),
    {
      ok: true,
      value: [
        toPublicRecord(first),
        toPublicRecord(second),
        toPublicRecord(otherVisit),
      ],
    },
  );
});

test('opening missing VisitMedia metadata returns not_found without reading objects', async () => {
  let objectReads = 0;
  const application = createAtlasApplication(
    createMediaOperationGroup(new InMemoryVisitMediaState(), {
      async get() {
        objectReads += 1;
        return undefined;
      },
    }),
  );

  assert.deepEqual(
    await application.openMedia({
      key: 'media.open',
      input: { id: 'missing-media' },
    }),
    {
      ok: false,
      error: { kind: 'not_found', message: 'Photo not found.' },
    },
  );
  assert.equal(objectReads, 0);
});

test('opening VisitMedia with a missing object returns dependency_failure', async () => {
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState([first]),
      new InMemoryMediaObjectStore(),
    ),
  );

  assert.deepEqual(
    await application.openMedia({
      key: 'media.open',
      input: { id: first.id },
    }),
    {
      ok: false,
      error: {
        kind: 'dependency_failure',
        message: 'Photo content is temporarily unavailable.',
      },
    },
  );
});

test('stream failures after open are sanitized before reaching the caller', async () => {
  const source = new ReadableStream({
    pull(controller) {
      controller.error(new Error('secret bucket failure'));
    },
  });
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState([first]),
      new InMemoryMediaObjectStore(
        new Map([[first.objectKey, { body: source, etag: '"etag-1"' }]]),
      ),
    ),
  );

  const result = await application.openMedia({
    key: 'media.open',
    input: { id: first.id },
  });
  assert.equal(result.ok, true);
  await assert.rejects(result.value.body.getReader().read(), (error) => {
    assert.equal(error.message, 'The photo stream could not be read.');
    assert.doesNotMatch(error.message, /secret|bucket/u);
    return true;
  });
});

test('an opened MediaContent stream has one consumer and propagates cancellation', async () => {
  let cancellations = 0;
  const source = new ReadableStream({
    cancel() {
      cancellations += 1;
    },
  });
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState([first]),
      new InMemoryMediaObjectStore(
        new Map([[first.objectKey, { body: source }]]),
      ),
    ),
  );

  const result = await application.openMedia({
    key: 'media.open',
    input: { id: first.id },
  });
  assert.equal(result.ok, true);
  const reader = result.value.body.getReader();
  assert.throws(() => result.value.body.getReader(), TypeError);
  await reader.cancel('client aborted');
  assert.equal(cancellations, 1);
});

test('Media read dependency failures expose no storage details', async () => {
  const application = createAtlasApplication(
    createMediaOperationGroup(new InMemoryVisitMediaState([first]), {
      async get() {
        throw new Error('R2 bucket credential leaked');
      },
    }),
  );

  const result = await application.openMedia({
    key: 'media.open',
    input: { id: first.id },
  });
  assert.deepEqual(result, {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'Photo content is temporarily unavailable.',
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /R2|bucket|credential/u);
});

function toPublicRecord({ objectKey: _objectKey, ...record }) {
  return { ...record, contentUrl: `/api/media/${record.id}/content` };
}
