import assert from 'node:assert/strict';
import test from 'node:test';

import { lookupNavitimeDirectTrain } from './navitime-transit-transport.ts';

const request = {
  origin: { latitude: 35.672949, longitude: 139.763166 },
  destination: { latitude: 35.6629, longitude: 139.7312 },
};
const now = () => new Date('2026-09-30T00:01:02.000Z');
const direct = {
  summary: { move: { type: 'move', time: 18, transit_count: 0 } },
  sections: [
    { type: 'point' },
    { type: 'move', move: 'walk', time: 4 },
    { type: 'point' },
    { type: 'move', move: 'local_train', line_name: 'Line A', time: 9 },
    { type: 'point' },
    { type: 'move', move: 'walk', time: 5 },
    { type: 'point' },
  ],
};

test('NAVITIME request uses owner coordinates, explicit average data and secret headers', async () => {
  const seen = [];
  const result = await lookupNavitimeDirectTrain(request, {
    apiKey: 'test-key',
    now,
    fetch: async (url, init) => {
      seen.push({ url, init });
      return Response.json({
        items: [direct],
        ignoredProviderField: 'discard',
      });
    },
  });
  assert.deepEqual(result, {
    status: 'ok',
    directRoute: {
      durationSeconds: 1080,
      lineIdentity: 'Line A',
      estimateBasis: 'average',
    },
    checkedAt: '2026-09-30T00:01:02.000Z',
  });
  assert.equal(seen.length, 1);
  const url = new URL(seen[0].url);
  assert.equal(url.searchParams.get('start'), '35.672949,139.763166');
  assert.equal(url.searchParams.get('goal'), '35.6629,139.7312');
  assert.equal(url.searchParams.get('start_time'), '2026-09-30T09:01:02');
  assert.equal(url.searchParams.get('train_data'), 'average');
  assert.equal(url.searchParams.get('bus_data'), 'none');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.doesNotMatch(seen[0].url, /test-key/u);
  assert.equal(seen[0].init.headers['x-rapidapi-key'], 'test-key');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(seen[0].init.cache, 'no-store');
  assert.doesNotMatch(JSON.stringify(result), /ignoredProviderField/u);
});

test('NAVITIME lookup fails closed before egress for invalid, uncovered or unconfigured calls', async () => {
  let calls = 0;
  const input = {
    apiKey: 'test-key',
    now,
    fetch: async () => {
      calls++;
      return Response.json({ items: [] });
    },
  };
  assert.deepEqual(
    await lookupNavitimeDirectTrain(
      { ...request, origin: { ...request.origin, latitude: 900 } },
      input,
    ),
    { status: 'invalid_request' },
  );
  assert.deepEqual(
    await lookupNavitimeDirectTrain(
      { ...request, origin: { latitude: 38.72, longitude: -9.14 } },
      input,
    ),
    { status: 'unsupported_region' },
  );
  assert.deepEqual(
    await lookupNavitimeDirectTrain(request, { ...input, apiKey: undefined }),
    { status: 'not_configured' },
  );
  assert.equal(calls, 0);
});

test('NAVITIME outage and malformed bodies are not evidence of no direct route', async () => {
  for (const response of [
    new Response(null, { status: 302 }),
    new Response(null, { status: 429 }),
    Response.json({}),
  ]) {
    assert.deepEqual(
      await lookupNavitimeDirectTrain(request, {
        apiKey: 'test-key',
        now,
        fetch: async () => response,
      }),
      { status: 'unavailable' },
    );
  }
  assert.deepEqual(
    await lookupNavitimeDirectTrain(request, {
      apiKey: 'test-key',
      now,
      fetch: async () => Response.json({ items: [] }),
    }),
    { status: 'ok', directRoute: null, checkedAt: now().toISOString() },
  );
});
