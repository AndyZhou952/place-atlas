import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CatalogIntakeRequestError,
  createBrowserAtlasApplication,
} from './atlas-api-client.ts';
import { subscribeOwnerLoginRequired } from './owner-session-client.ts';

test('Browser AtlasApplication maps typed operations through an injected transport', async () => {
  const calls = [];
  const item = {
    id: 'place-1',
    kind: 'food',
    title: '店',
    area: 'Ginza',
    address: 'Tokyo',
    description: 'A quiet counter.',
    latitude: 35.67,
    longitude: 139.76,
    verificationStatus: 'verified',
    reservation: {
      mode: 'walk-in',
      label: 'Walk in',
      checkedAt: '2026-09-23T12:00:00.000Z',
    },
    tags: [],
    sources: [],
    overallComment: 'A quiet counter worth revisiting.',
  };
  const application = createBrowserAtlasApplication({
    async request(url, init) {
      calls.push({ url, init });
      if (url === '/api/items') return Response.json([item]);
      if (init?.method === undefined) {
        return Response.json({
          favorite: false,
          effectiveVisited: false,
          overallComment: item.overallComment,
        });
      }
      return mutationResponse(init, {
        item: { ...item, personalRating: null },
      });
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

  assert.deepEqual(items, [
    {
      ...item,
      verifiedAt: item.reservation.checkedAt,
      personalState: 'candidate',
      personalRating: undefined,
      isFavorite: false,
      hasVisited: false,
    },
  ]);
  assert.deepEqual(updated, { ...item, personalRating: undefined });
  assert.equal(calls[0].url, '/api/items');
  assert.equal(calls[0].init?.method, undefined);
  assert.equal(calls[1].url, '/api/items/place-1/personal');
  assert.equal(calls[1].init?.method, undefined);
  assert.equal(calls[2].url, '/api/items/place-1/personal');
  assert.equal(calls[2].init?.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    isFavorite: true,
    hasVisited: false,
    summary: 'A quiet counter worth revisiting.',
  });
  assert.match(
    new Headers(calls[2].init.headers).get('x-atlas-mutation-id'),
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

test('catalog intake stores the server conversation, returns it on the next operation, and never sends owner identity', async () => {
  const calls = [];
  let storedConversation;
  const application = createBrowserAtlasApplication(
    {
      async request(url, init) {
        calls.push({
          url,
          headers: Object.fromEntries(new Headers(init?.headers)),
          body: JSON.parse(init.body),
        });
        return new Response(
          JSON.stringify(
            url.endsWith('/discover')
              ? {
                  status: 'candidates_ready',
                  sessionId: 'session-1',
                  sessionVersion: 1,
                  candidates: [],
                  hasMore: false,
                  expiresAt: '2026-09-22T10:30:00.000Z',
                }
              : {
                  status: 'cancelled',
                  sessionId: 'session-1',
                  sessionVersion: 2,
                },
          ),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-atlas-web-conversation-id': '000102030405060708090a0b0c0d0e0f',
            },
          },
        );
      },
    },
    {
      read: () => storedConversation,
      write: (value) => {
        storedConversation = value;
      },
    },
  );

  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '鮨青空', requestToken: 'request-1' },
  });
  await application.execute({
    key: 'catalog.intake.cancel',
    input: { sessionId: 'session-1', expectedSessionVersion: 1 },
  });

  assert.equal(calls[0].url, '/api/catalog-intake/discover');
  assert.equal(calls[0].headers['x-atlas-web-conversation-id'], undefined);
  assert.deepEqual(calls[0].body, {
    input: { query: '鮨青空', requestToken: 'request-1' },
  });
  assert.equal(calls[1].url, '/api/catalog-intake/cancel');
  assert.equal(
    calls[1].headers['x-atlas-web-conversation-id'],
    '000102030405060708090a0b0c0d0e0f',
  );
  assert.equal(JSON.stringify(calls).includes('ownerId'), false);
});

test('catalog intake exposes a typed closed error and requests login without dropping client state', async () => {
  let loginRequests = 0;
  const unsubscribe = subscribeOwnerLoginRequired(() => {
    loginRequests += 1;
  });
  const application = createBrowserAtlasApplication(
    {
      async request() {
        return Response.json(
          {
            code: 'unauthorized',
            message: 'Owner login is required.',
            retryable: false,
            internal: 'do not trust',
          },
          { status: 401 },
        );
      },
    },
    { read: () => undefined, write() {} },
  );

  await assert.rejects(
    application.execute({
      key: 'catalog.intake.discover',
      input: { query: '鮨青空', requestToken: 'request-1' },
    }),
    (error) => {
      assert.ok(error instanceof CatalogIntakeRequestError);
      assert.equal(error.code, 'unauthorized');
      assert.equal(error.retryable, false);
      assert.deepEqual(Object.keys(error), ['code', 'retryable']);
      return true;
    },
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
        (url === '/api/journal' ||
          url.startsWith('/api/media?') ||
          url.startsWith('/api/nearby?')) &&
        (init?.method === undefined || init.method === 'GET');
      const isCoordinatedWrite =
        url.startsWith('/api/journal') ||
        url.startsWith('/api/media/') ||
        (url.startsWith('/api/items/') && init?.method === 'PATCH');
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
    key: 'media.score',
    input: { id: 'media / 1', score: 4.2 },
  });
  await application.execute({
    key: 'media.delete',
    input: { id: 'media / 1' },
  });
  await application.execute({
    key: 'nearby.recommend',
    input: { locationHint: '銀座' },
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
      method: 'PATCH',
      body: { score: 4.2 },
    },
    {
      url: '/api/media/media%20%2F%201',
      method: 'DELETE',
      body: undefined,
    },
    {
      url: '/api/nearby?locationHint=%E9%8A%80%E5%BA%A7',
      method: 'GET',
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
