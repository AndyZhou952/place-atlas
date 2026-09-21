import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from './media-read-memory.ts';
import { createMediaOperationGroup } from './media-operations.ts';

const metadata = {
  id: 'internal-media-1',
  displayId: 'pm_opaque_1',
  visitId: 'visit-1',
  itemId: 'item-1',
  objectKey: 'visits/visit-1/internal-media-1',
  originalFilename: 'private.jpg',
  contentType: 'image/jpeg',
  byteSize: 3,
  contentSha256: 'private-hash',
  displayOrder: 0,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
};

void test('media.openDisplay resolves an opaque display ID before object storage', async () => {
  const objectReads = [];
  const application = createAtlasApplication(
    createMediaOperationGroup(new InMemoryVisitMediaState([metadata]), {
      async get(objectKey) {
        objectReads.push(objectKey);
        return {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.of(1, 2, 3));
              controller.close();
            },
          }),
        };
      },
      async put() {},
      async delete() {},
    }),
  );

  const missing = await application.openMedia({
    key: 'media.openDisplay',
    input: { displayId: 'pm_unknown-token' },
  });
  const found = await application.openMedia({
    key: 'media.openDisplay',
    input: { displayId: metadata.displayId },
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.error.kind, 'not_found');
  assert.deepEqual(objectReads, [metadata.objectKey]);
  assert.equal(found.ok, true);
  assert.equal(found.value.contentType, 'image/jpeg');
});

void test('media.attach creates an opaque display ID independently of the internal ID', async () => {
  const state = new InMemoryVisitMediaState(
    [],
    new Map([['visit-1', { itemId: 'item-1' }]]),
  );
  const application = createAtlasApplication(
    createMediaOperationGroup(state, new InMemoryMediaObjectStore(), {
      clock: { now: () => '2026-09-20T00:00:00.000Z' },
      idSource: { nextId: () => 'internal-media-1' },
      displayIdSource: { nextId: () => 'random-public-token' },
      digest: async () => 'hash',
    }),
  );

  const attached = await application.execute({
    key: 'media.attach',
    input: {
      visitId: 'visit-1',
      uploads: [
        {
          originalFilename: 'private.jpg',
          contentType: 'image/jpeg',
          bytes: Uint8Array.of(0xff, 0xd8, 0xff),
        },
      ],
    },
  });
  const stored = await state.findByDisplayId('pm_random-public-token');

  assert.equal(attached.ok, true);
  assert.equal(stored.id, 'internal-media-1');
  assert.equal(stored.displayId, 'pm_random-public-token');
  assert.notEqual(stored.displayId, stored.id);
});
