import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createMediaOperationGroup } from './media-operations.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from './media-read-memory.ts';

const jpegBytes = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const dependencies = {
  clock: { now: () => '2026-09-12T08:00:00.000Z' },
  idSource: { nextId: () => 'generated-media' },
  displayIdSource: { nextId: () => 'public-media-token' },
  digest: async () =>
    '374ffede23adbc8bc625205f4bf86750807ffb6ce71fc7d10cac8bded0872bf5',
};

test('attach stores a validated image before committing ordered VisitMedia metadata', async () => {
  const events = [];
  const state = {
    async list() {
      return [];
    },
    async find() {
      return undefined;
    },
    async getVisitContext(visitId) {
      assert.equal(visitId, 'visit-1');
      return { itemId: 'item-1', nextDisplayOrder: 4 };
    },
    async insert(records) {
      events.push({ type: 'insert', records });
    },
  };
  const objects = {
    async get() {
      return undefined;
    },
    async put(input) {
      events.push({ type: 'put', input });
    },
    async delete() {},
  };
  const application = createAtlasApplication(
    createMediaOperationGroup(state, objects, dependencies),
  );

  const result = await application.execute({
    key: 'media.attach',
    input: {
      visitId: 'visit-1',
      uploads: [
        {
          id: 'media-1',
          originalFilename: '',
          contentType: 'image/jpeg',
          bytes: jpegBytes,
          caption: '  Chef   selection  ',
        },
      ],
    },
  });

  const expected = {
    id: 'media-1',
    visitId: 'visit-1',
    itemId: 'item-1',
    objectKey: 'visits/visit-1/media-1',
    originalFilename: 'media',
    contentType: 'image/jpeg',
    byteSize: 4,
    displayId: 'pm_public-media-token',
    contentSha256:
      '374ffede23adbc8bc625205f4bf86750807ffb6ce71fc7d10cac8bded0872bf5',
    caption: 'Chef selection',
    displayOrder: 4,
    createdAt: '2026-09-12T08:00:00.000Z',
    updatedAt: '2026-09-12T08:00:00.000Z',
  };
  assert.deepEqual(events, [
    {
      type: 'put',
      input: {
        objectKey: expected.objectKey,
        bytes: jpegBytes,
        contentType: 'image/jpeg',
        mediaId: 'media-1',
        visitId: 'visit-1',
        contentSha256: expected.contentSha256,
      },
    },
    { type: 'insert', records: [expected] },
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: [
      {
        ...expected,
        objectKey: undefined,
        contentUrl: '/api/media/media-1/content',
      },
    ].map(
      ({ objectKey: _objectKey, displayId: _displayId, ...record }) => record,
    ),
  });
});

test('attach accepts matching image and video signatures', async () => {
  const cases = [
    ['image/jpeg', jpegBytes],
    [
      'image/png',
      Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    ],
    ['image/webp', Uint8Array.from(Buffer.from('RIFF0000WEBP'))],
    ['image/gif', Uint8Array.from(Buffer.from('GIF87a'))],
    ['image/gif', Uint8Array.from(Buffer.from('GIF89a'))],
    ['video/mp4', Uint8Array.from(Buffer.from('0000ftypisom'))],
    ['video/webm', Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3)],
  ];

  for (const [contentType, bytes] of cases) {
    const application = writableApplication();
    const result = await application.execute({
      key: 'media.attach',
      input: {
        visitId: 'visit-1',
        uploads: [{ originalFilename: 'image', contentType, bytes }],
      },
    });
    assert.equal(result.ok, true, contentType);
  }
});

test('caption update normalizes one line and returns the public VisitMedia record', async () => {
  const base = {
    id: 'media-1',
    visitId: 'visit-1',
    itemId: 'item-1',
    objectKey: 'visits/visit-1/media-1',
    originalFilename: 'sushi.jpg',
    contentType: 'image/jpeg',
    byteSize: 4,
    contentSha256: 'hash-1',
    displayOrder: 0,
    createdAt: '2026-09-11T08:00:00.000Z',
    updatedAt: '2026-09-11T08:00:00.000Z',
  };
  let update;
  const application = writableApplication({
    state: {
      async updateCaption(id, caption, updatedAt) {
        update = { id, caption, updatedAt };
        return { ...base, caption, updatedAt };
      },
    },
  });

  const result = await application.execute({
    key: 'media.caption',
    input: { id: 'media-1', caption: '  tuna\n  course  ' },
  });

  assert.deepEqual(update, {
    id: 'media-1',
    caption: 'tuna course',
    updatedAt: '2026-09-12T08:00:00.000Z',
  });
  assert.deepEqual(result, {
    ok: true,
    value: {
      id: base.id,
      visitId: base.visitId,
      itemId: base.itemId,
      originalFilename: base.originalFilename,
      contentType: base.contentType,
      byteSize: base.byteSize,
      contentSha256: base.contentSha256,
      displayOrder: base.displayOrder,
      createdAt: base.createdAt,
      caption: 'tuna course',
      contentUrl: '/api/media/media-1/content',
      updatedAt: '2026-09-12T08:00:00.000Z',
    },
  });
});

test('single delete commits D1 metadata before deleting the R2 object', async () => {
  const events = [];
  const metadata = {
    id: 'media-1',
    visitId: 'visit-1',
    itemId: 'item-1',
    objectKey: 'visits/visit-1/media-1',
    originalFilename: 'sushi.jpg',
    contentType: 'image/jpeg',
    byteSize: 4,
    contentSha256: 'hash-1',
    displayOrder: 0,
    createdAt: '2026-09-11T08:00:00.000Z',
    updatedAt: '2026-09-11T08:00:00.000Z',
  };
  const application = writableApplication({
    state: {
      async delete(id) {
        events.push(['d1-delete', id]);
        return metadata;
      },
    },
    objects: {
      async delete(key) {
        events.push(['r2-delete', key]);
      },
    },
  });

  const result = await application.execute({
    key: 'media.delete',
    input: { id: 'media-1' },
  });

  assert.deepEqual(events, [
    ['d1-delete', 'media-1'],
    ['r2-delete', 'visits/visit-1/media-1'],
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: { id: 'media-1', deleted: true },
  });
});

test('the InMemory adapters exercise the same attach and read interface', async () => {
  const state = new InMemoryVisitMediaState(
    [],
    new Map([['visit-1', { itemId: 'item-1' }]]),
  );
  const objects = new InMemoryMediaObjectStore();
  const application = createAtlasApplication(
    createMediaOperationGroup(state, objects, dependencies),
  );

  const attached = await application.execute({
    key: 'media.attach',
    input: {
      visitId: 'visit-1',
      uploads: [
        {
          id: 'media-1',
          originalFilename: 'sushi.jpg',
          contentType: 'image/jpeg',
          bytes: jpegBytes,
        },
      ],
    },
  });
  const listed = await application.execute({
    key: 'media.list',
    input: { visitId: 'visit-1' },
  });
  const opened = await application.openMedia({
    key: 'media.open',
    input: { id: 'media-1' },
  });

  assert.equal(attached.ok, true);
  assert.deepEqual(listed, attached);
  assert.equal(opened.ok, true);
  assert.deepEqual(
    new Uint8Array(await new Response(opened.value.body).arrayBuffer()),
    jpegBytes,
  );
});

test('attach rejects unsupported, mismatched, empty, oversized, and overlong-caption images', async () => {
  const oversized = new Uint8Array(8 * 1024 * 1024 + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  const cases = [
    [
      'text/plain',
      jpegBytes,
      undefined,
      'Use a JPEG, PNG, WebP, GIF, MP4, or WebM file.',
    ],
    [
      'image/png',
      jpegBytes,
      undefined,
      'The file contents do not match the image type.',
    ],
    [
      'image/jpeg',
      new Uint8Array(),
      undefined,
      'Each image must be between 1 byte and 8 MB.',
    ],
    [
      'image/jpeg',
      oversized,
      undefined,
      'Each image must be between 1 byte and 8 MB.',
    ],
    [
      'image/jpeg',
      jpegBytes,
      'x'.repeat(161),
      'Caption must be 160 characters or fewer.',
    ],
  ];

  for (const [contentType, bytes, caption, message] of cases) {
    const result = await writableApplication().execute({
      key: 'media.attach',
      input: {
        visitId: 'visit-1',
        uploads: [{ originalFilename: 'image', contentType, bytes, caption }],
      },
    });
    assert.deepEqual(result, {
      ok: false,
      error: { kind: 'invalid_input', message },
    });
  }
});

test('a mixed valid/invalid batch still puts valid objects before best-effort cleanup', async () => {
  const events = [];
  const application = writableApplication({
    state: {
      async insert() {
        events.push('unexpected-insert');
      },
    },
    objects: {
      async put(input) {
        events.push(['put', input.objectKey]);
      },
      async delete(key) {
        events.push(['cleanup', key]);
      },
    },
  });

  const result = await application.execute({
    key: 'media.attach',
    input: {
      visitId: 'visit-1',
      uploads: [
        {
          id: 'valid',
          originalFilename: 'valid.jpg',
          contentType: 'image/jpeg',
          bytes: jpegBytes,
        },
        {
          id: 'invalid',
          originalFilename: 'invalid.png',
          contentType: 'image/png',
          bytes: jpegBytes,
        },
      ],
    },
  });

  assert.deepEqual(events, [
    ['put', 'visits/visit-1/valid'],
    ['cleanup', 'visits/visit-1/valid'],
  ]);
  assert.deepEqual(result, {
    ok: false,
    error: {
      kind: 'invalid_input',
      message: 'The file contents do not match the image type.',
    },
  });
});

test('a D1 metadata failure cleans up every successfully stored object', async () => {
  const events = [];
  const application = writableApplication({
    state: {
      async insert() {
        events.push('insert');
        throw new Error('secret D1 failure');
      },
    },
    objects: {
      async put(input) {
        events.push(['put', input.objectKey]);
      },
      async delete(key) {
        events.push(['cleanup', key]);
      },
    },
  });

  const result = await application.execute({
    key: 'media.attach',
    input: {
      visitId: 'visit-1',
      uploads: [
        {
          id: 'media-1',
          originalFilename: 'sushi.jpg',
          contentType: 'image/jpeg',
          bytes: jpegBytes,
        },
      ],
    },
  });

  assert.deepEqual(events, [
    ['put', 'visits/visit-1/media-1'],
    'insert',
    ['cleanup', 'visits/visit-1/media-1'],
  ]);
  assert.deepEqual(result, {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'Visit photos could not be saved.',
    },
  });
});

test('an R2 put failure cleans up other successful objects without inserting metadata', async () => {
  const events = [];
  const application = writableApplication({
    state: {
      async insert() {
        events.push('unexpected-insert');
      },
    },
    objects: {
      async put(input) {
        events.push(['put', input.objectKey]);
        if (input.mediaId === 'media-2') throw new Error('secret R2 failure');
      },
      async delete(key) {
        events.push(['cleanup', key]);
      },
    },
  });

  const result = await application.execute({
    key: 'media.attach',
    input: {
      visitId: 'visit-1',
      uploads: [
        {
          id: 'media-1',
          originalFilename: '1.jpg',
          contentType: 'image/jpeg',
          bytes: jpegBytes,
        },
        {
          id: 'media-2',
          originalFilename: '2.jpg',
          contentType: 'image/jpeg',
          bytes: jpegBytes,
        },
      ],
    },
  });

  assert.deepEqual(events, [
    ['put', 'visits/visit-1/media-1'],
    ['put', 'visits/visit-1/media-2'],
    ['cleanup', 'visits/visit-1/media-1'],
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'dependency_failure');
  assert.doesNotMatch(JSON.stringify(result), /secret|R2/u);
});

test('an R2 delete failure leaves the object orphaned after metadata is gone', async () => {
  let metadataExists = true;
  let objectDeletes = 0;
  const metadata = {
    id: 'media-1',
    visitId: 'visit-1',
    itemId: 'item-1',
    objectKey: 'visits/visit-1/media-1',
    originalFilename: 'sushi.jpg',
    contentType: 'image/jpeg',
    byteSize: 4,
    contentSha256: 'hash-1',
    displayOrder: 0,
    createdAt: 'created',
    updatedAt: 'updated',
  };
  const application = writableApplication({
    state: {
      async delete() {
        if (!metadataExists) return undefined;
        metadataExists = false;
        return metadata;
      },
    },
    objects: {
      async delete() {
        objectDeletes += 1;
        throw new Error('secret R2 failure');
      },
    },
  });

  const failed = await application.execute({
    key: 'media.delete',
    input: { id: 'media-1' },
  });
  const retried = await application.execute({
    key: 'media.delete',
    input: { id: 'media-1' },
  });

  assert.equal(failed.ok, false);
  assert.equal(failed.error.kind, 'dependency_failure');
  assert.deepEqual(retried, {
    ok: false,
    error: { kind: 'not_found', message: 'Photo not found.' },
  });
  assert.equal(objectDeletes, 1);
});

function writableApplication(overrides = {}) {
  const state = {
    async list() {
      return [];
    },
    async findByDisplayId() {
      return undefined;
    },
    async find() {
      return undefined;
    },
    async getVisitContext() {
      return { itemId: 'item-1', nextDisplayOrder: 0 };
    },
    async insert() {},
    ...overrides.state,
  };
  const objects = {
    async get() {
      return undefined;
    },
    async put() {},
    async delete() {},
    ...overrides.objects,
  };
  return createAtlasApplication(
    createMediaOperationGroup(state, objects, dependencies),
  );
}
