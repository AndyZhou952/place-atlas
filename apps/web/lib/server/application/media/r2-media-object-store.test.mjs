import assert from 'node:assert/strict';
import test from 'node:test';

import { R2MediaObjectStore } from './r2-media-object-store.ts';

test('the R2 adapter exposes only the portable stream and ETag envelope', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2, 3));
      controller.close();
    },
  });
  const bucket = {
    async get(key) {
      assert.equal(key, 'visits/visit-1/media-1');
      return {
        body,
        httpEtag: '"r2-etag"',
        vendorOnly: 'must not cross the seam',
      };
    },
  };

  assert.deepEqual(
    await new R2MediaObjectStore(bucket).get('visits/visit-1/media-1'),
    { body, etag: '"r2-etag"' },
  );
});

test('the R2 adapter preserves a missing object as undefined', async () => {
  const bucket = {
    async get() {
      return null;
    },
  };

  assert.equal(
    await new R2MediaObjectStore(bucket).get('missing-object'),
    undefined,
  );
});

test('the R2 adapter maps portable media writes and deletes', async () => {
  const calls = [];
  const bucket = {
    async put(...args) {
      calls.push(['put', ...args]);
    },
    async delete(...args) {
      calls.push(['delete', ...args]);
    },
  };
  const store = new R2MediaObjectStore(bucket);
  const bytes = Uint8Array.of(0xff, 0xd8, 0xff);

  await store.put({
    objectKey: 'visits/visit-1/media-1',
    bytes,
    contentType: 'image/jpeg',
    mediaId: 'media-1',
    visitId: 'visit-1',
    contentSha256: 'sha-1',
  });
  await store.delete('visits/visit-1/media-1');

  assert.deepEqual(calls, [
    [
      'put',
      'visits/visit-1/media-1',
      bytes,
      {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: {
          mediaId: 'media-1',
          visitId: 'visit-1',
          sha256: 'sha-1',
        },
      },
    ],
    ['delete', 'visits/visit-1/media-1'],
  ]);
});
