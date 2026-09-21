import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserAtlasApplication } from './atlas-api-client.ts';
import { subscribeOwnerLoginRequired } from './owner-session-client.ts';

test('Browser AtlasApplication maps typed operations through an injected transport', async () => {
  const calls = [];
  const item = {
    id: 'place-1',
    title: '店',
    overallComment: 'A quiet counter worth revisiting.',
  };
  const application = createBrowserAtlasApplication({
    async request(url, init) {
      calls.push({ url, init });
      return url === '/api/items'
        ? Response.json([item])
        : mutationResponse(init, { item });
    },
  });

  const items = await application.execute({
    key: 'catalog.list',
    input: { profile: 'full_merged_catalog' },
  });
  const updated = await application.execute({
    key: 'assessment.update',
    input: {
      itemId: 'place-1',
      patch: {
        isFavorite: true,
        manualVisited: false,
        summary: 'A quiet counter worth revisiting.',
      },
    },
  });

  assert.deepEqual(items, [item]);
  assert.deepEqual(updated, item);
  assert.equal(calls[0].url, '/api/items');
  assert.equal(calls[0].init?.method, undefined);
  assert.equal(calls[1].url, '/api/items/place-1/personal');
  assert.equal(calls[1].init?.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    isFavorite: true,
    hasVisited: false,
    summary: 'A quiet counter worth revisiting.',
  });
  assert.match(
    new Headers(calls[1].init.headers).get('x-atlas-mutation-id'),
    /^[0-9a-f-]+$/u,
  );
});

test('an unauthorized Atlas write requests Owner login and rejects without reporting success', async () => {
  let loginRequests = 0;
  const unsubscribe = subscribeOwnerLoginRequired(() => {
    loginRequests += 1;
  });
  const application = createBrowserAtlasApplication({
    async request() {
      return new Response('Owner login is required.', { status: 401 });
    },
  });

  await assert.rejects(
    application.execute({
      key: 'assessment.update',
      input: { itemId: 'place-1', patch: { isFavorite: true } },
    }),
    /Owner login is required\./,
  );
  unsubscribe();

  assert.equal(loginRequests, 1);
});

test('Browser AtlasApplication preserves every existing JSON route shape', async () => {
  const calls = [];
  const application = createBrowserAtlasApplication({
    async request(url, init) {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body:
          typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      const isList =
        (url === '/api/inbox' ||
          url === '/api/journal' ||
          url.startsWith('/api/media?') ||
          url.startsWith('/api/nearby?')) &&
        (init?.method === undefined || init.method === 'GET');
      const isCoordinatedWrite =
        url.startsWith('/api/journal') || url.startsWith('/api/media/');
      return isCoordinatedWrite && init?.method !== undefined
        ? mutationResponse(init, { ok: true })
        : Response.json(isList ? [] : { ok: true });
    },
  });

  await application.execute({
    key: 'catalog.update_item',
    input: {
      id: 'place / 1',
      title: '店',
      description: '説明',
      personalState: 'saved',
    },
  });
  await application.execute({
    key: 'catalog.delete_item',
    input: { id: 'place / 1' },
  });
  await application.execute({ key: 'import.list', input: {} });
  await application.execute({
    key: 'import.queue',
    input: { creatorName: 'Creator', sourceRef: 'https://example.test' },
  });
  await application.execute({ key: 'visit.list', input: {} });
  await application.execute({
    key: 'visit.create',
    input: {
      id: 'visit-1',
      itemId: 'place-1',
      visitedAt: '2026-09-12',
      rating: 4.3,
    },
  });
  await application.execute({
    key: 'visit.update',
    input: {
      id: 'visit-1',
      visitedAt: '2026-09-13',
      rating: null,
      note: '',
    },
  });
  await application.execute({ key: 'visit.delete', input: { id: 'visit-1' } });
  await application.execute({
    key: 'media.list',
    input: { visitId: 'visit / 1', itemId: 'place / 1' },
  });
  await application.execute({
    key: 'media.caption',
    input: { id: 'media / 1', caption: null },
  });
  await application.execute({
    key: 'media.delete',
    input: { id: 'media / 1' },
  });
  await application.execute({
    key: 'decision.nearby',
    input: {
      latitude: 35.68,
      longitude: 139.76,
      limit: 5,
      profile: 'full_merged_catalog',
    },
  });

  assert.deepEqual(calls, [
    {
      url: '/api/items/place%20%2F%201',
      method: 'PATCH',
      body: {
        title: '店',
        description: '説明',
        personalState: 'saved',
      },
    },
    {
      url: '/api/items/place%20%2F%201',
      method: 'DELETE',
      body: undefined,
    },
    { url: '/api/inbox', method: 'GET', body: undefined },
    {
      url: '/api/inbox',
      method: 'POST',
      body: { creatorName: 'Creator', sourceRef: 'https://example.test' },
    },
    { url: '/api/journal', method: 'GET', body: undefined },
    {
      url: '/api/journal',
      method: 'POST',
      body: {
        id: 'visit-1',
        itemId: 'place-1',
        visitedAt: '2026-09-12',
        rating: 4.3,
      },
    },
    {
      url: '/api/journal/visit-1',
      method: 'PATCH',
      body: { visitedAt: '2026-09-13', rating: null, note: '' },
    },
    {
      url: '/api/journal/visit-1',
      method: 'DELETE',
      body: undefined,
    },
    {
      url: '/api/media?visitId=visit+%2F+1&itemId=place+%2F+1',
      method: 'GET',
      body: undefined,
    },
    {
      url: '/api/media/media%20%2F%201',
      method: 'PATCH',
      body: { caption: null },
    },
    {
      url: '/api/media/media%20%2F%201',
      method: 'DELETE',
      body: undefined,
    },
    {
      url: '/api/nearby?lat=35.68&lon=139.76&limit=5&profile=full_merged_catalog',
      method: 'GET',
      body: undefined,
    },
  ]);
});

test('Browser media attach accepts 24 files, sends four per request, and publishes each completed batch', async () => {
  const requests = [];
  const pending = [];
  const completedBatches = [];
  const application = createBrowserAtlasApplication({
    request(url, init) {
      requests.push({ url, init });
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  const files = Array.from(
    { length: 10 },
    (_, index) =>
      new File([`photo-${index}`], `photo-${index}.jpg`, {
        type: 'image/jpeg',
      }),
  );

  const upload = application.execute({
    key: 'media.attach',
    input: {
      visitId: 'visit-1',
      files,
      uploadIds: files.map((_, index) => `media-${index}`),
      captions: files.map((_, index) => `dish ${index}`),
      onBatchCompleted: (batch) => completedBatches.push(batch),
    },
  });

  await Promise.resolve();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/media');
  assert.equal(requests[0].init.body.getAll('files').length, 4);

  pending.shift()(mutationResponse(requests[0].init, [{ id: 'media-1' }], 201));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(completedBatches, [[{ id: 'media-1' }]]);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].init.body.getAll('captions'), [
    'dish 4',
    'dish 5',
    'dish 6',
    'dish 7',
  ]);

  pending.shift()(mutationResponse(requests[1].init, [{ id: 'media-2' }], 201));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 3);
  assert.equal(requests[2].init.body.getAll('files').length, 2);
  pending.shift()(mutationResponse(requests[2].init, [{ id: 'media-3' }], 201));

  assert.deepEqual(await upload, [
    { id: 'media-1' },
    { id: 'media-2' },
    { id: 'media-3' },
  ]);
  assert.deepEqual(completedBatches, [
    [{ id: 'media-1' }],
    [{ id: 'media-2' }],
    [{ id: 'media-3' }],
  ]);

  await assert.rejects(
    application.execute({
      key: 'media.attach',
      input: {
        visitId: 'visit-1',
        files: Array.from({ length: 25 }, (_, index) => files[index % 10]),
        uploadIds: Array.from(
          { length: 25 },
          (_, index) => `too-many-${index}`,
        ),
      },
    }),
    /Select no more than 24 photos at once/,
  );
  assert.equal(requests.length, 3);
});

test('a later upload failure keeps earlier completed batches observable', async () => {
  let requestCount = 0;
  const completedBatches = [];
  const application = createBrowserAtlasApplication({
    async request(_url, init) {
      requestCount += 1;
      return requestCount === 1
        ? mutationResponse(init, [{ id: 'stored' }], 201)
        : new Response('Visit photos could not be saved.', { status: 500 });
    },
  });
  const files = Array.from(
    { length: 5 },
    (_, index) => new File(['photo'], `photo-${index}.jpg`),
  );

  await assert.rejects(
    application.execute({
      key: 'media.attach',
      input: {
        visitId: 'visit-1',
        files,
        uploadIds: files.map((_, index) => `later-${index}`),
        onBatchCompleted: (batch) => completedBatches.push(batch),
      },
    }),
    /Visit photos could not be saved/,
  );

  assert.equal(requestCount, 2);
  assert.deepEqual(completedBatches, [[{ id: 'stored' }]]);
});

function mutationResponse(init, result, status = 200) {
  const mutationId = new Headers(init?.headers).get('x-atlas-mutation-id');
  assert.ok(mutationId);
  return Response.json(
    {
      mutationId,
      payloadDigest: 'a'.repeat(64),
      result,
      replayed: false,
    },
    { status },
  );
}
