import assert from 'node:assert/strict';
import test from 'node:test';

import { createMediaContentGet } from './media-content-route.ts';

function mediaBody() {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2, 3));
      controller.close();
    },
  });
}

void test('anonymous internal IDs are rejected before application or R2 composition', async () => {
  let applicationCompositions = 0;
  const GET = createMediaContentGet({
    async authorizeOwnerRead() {
      return new Response('Owner login is required.', { status: 401 });
    },
    getApplication() {
      applicationCompositions += 1;
      throw new Error('must not compose');
    },
  });

  const response = await GET(
    new Request('https://atlas.example/api/media/internal-1/content'),
    { params: Promise.resolve({ id: 'internal-1' }) },
  );

  assert.equal(response.status, 401);
  assert.equal(applicationCompositions, 0);
});

void test('anonymous opaque display IDs execute only media.openDisplay', async () => {
  const operations = [];
  let authorizations = 0;
  const GET = createMediaContentGet({
    async authorizeOwnerRead() {
      authorizations += 1;
      return new Response('unexpected', { status: 401 });
    },
    getApplication() {
      return {
        async openMedia(call) {
          operations.push(call);
          return {
            ok: true,
            value: {
              body: mediaBody(),
              contentType: 'image/jpeg',
              byteSize: 3,
            },
          };
        },
      };
    },
  });

  const response = await GET(
    new Request('https://atlas.example/api/media/pm_public-token/content'),
    { params: Promise.resolve({ id: 'pm_public-token' }) },
  );

  assert.equal(response.status, 200);
  assert.equal(authorizations, 0);
  assert.deepEqual(operations, [
    {
      key: 'media.openDisplay',
      input: { displayId: 'pm_public-token' },
    },
  ]);
});

void test('authenticated internal IDs return bytes through media.open', async () => {
  const operations = [];
  const GET = createMediaContentGet({
    async authorizeOwnerRead() {
      return undefined;
    },
    getApplication() {
      return {
        async openMedia(call) {
          operations.push(call);
          return {
            ok: true,
            value: {
              body: mediaBody(),
              contentType: 'image/jpeg',
              byteSize: 3,
            },
          };
        },
      };
    },
  });

  const response = await GET(
    new Request('https://atlas.example/api/media/internal-1/content'),
    { params: Promise.resolve({ id: 'internal-1' }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(operations, [
    { key: 'media.open', input: { id: 'internal-1' } },
  ]);
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    Uint8Array.of(1, 2, 3),
  );
});
