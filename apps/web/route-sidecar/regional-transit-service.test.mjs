import assert from 'node:assert/strict';
import test from 'node:test';

import { createRegionalTransitService } from './regional-transit-service.ts';
import { createMeteredRouteSidecarClient } from './metered-route-sidecar-client.ts';
import { createRouteSidecarNearbyAdapter } from './route-sidecar-nearby-adapter.ts';

const japan = {
  origin: { latitude: 35.672949, longitude: 139.763166 },
  destination: { latitude: 35.6629, longitude: 139.7312 },
};
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

test('regional service returns a bounded average estimate and never invokes Google in Japan', async () => {
  let googleCalls = 0;
  let navitimeCalls = 0;
  const regional = createRegionalTransitService({
    googleTransit: async () => {
      googleCalls++;
      return { ok: false, error: 'dependency_failure' };
    },
    navitimeApiKey: 'test-key',
    now: () => new Date('2026-09-30T00:00:00Z'),
    fetch: async () => {
      navitimeCalls++;
      return Response.json({ items: [direct] });
    },
  });
  const usage = [];
  const metered = createMeteredRouteSidecarClient({
    service: {
      transit: regional,
      async japanTransitReady() {
        return true;
      },
    },
    usage: {
      async reserve(value) {
        usage.push(value);
        return 'reserved';
      },
    },
    japanTransitEnabled: true,
  });
  const adapter = createRouteSidecarNearbyAdapter(metered, {
    japanTransitEnabled: true,
  });
  assert.equal(
    adapter.transitRouteProvider.coverage(japan.origin),
    'supported',
  );
  const result = await adapter.transitRouteProvider.transit(
    japan.origin,
    japan.destination,
  );
  assert.equal(result.status, 'fresh');
  assert.equal(result.durationSeconds, 1080);
  assert.equal(result.estimateBasis, 'average');
  assert.deepEqual(result.lineIdentities, ['Line A']);
  assert.deepEqual([googleCalls, navitimeCalls], [0, 1]);
  assert.equal(usage[0].providerId, 'navitime-rapidapi');
  assert.equal(usage[0].hardRequestLimit, 250);
  assert.equal(usage[0].costUsd, 0);
  assert.equal(usage[0].hardCostLimitUsd, 0);
});

test('unconfigured or malformed Japan provider responses remain unavailable', async () => {
  for (const [key, response] of [
    [undefined, Response.json({ items: [direct] })],
    ['test-key', Response.json({ invalid: true })],
  ]) {
    const regional = createRegionalTransitService({
      googleTransit: async () => {
        throw new Error('Google must not run in Japan');
      },
      navitimeApiKey: key,
      now: () => new Date('2026-09-30T00:00:00Z'),
      fetch: async () => response,
    });
    assert.equal((await regional(japan)).ok, false);
  }
});

test('a missing optional credential does not reserve quota or contact a route provider', async () => {
  let reservations = 0;
  let providerCalls = 0;
  const client = createMeteredRouteSidecarClient({
    service: {
      async japanTransitReady() {
        return false;
      },
      async transit() {
        providerCalls++;
        return { ok: false, error: 'dependency_failure' };
      },
    },
    usage: {
      async reserve() {
        reservations++;
        return 'reserved';
      },
    },
    japanTransitEnabled: true,
  });
  assert.deepEqual(await client.transit(japan), {
    ok: false,
    error: 'not_configured',
  });
  assert.deepEqual([reservations, providerCalls], [0, 0]);
});
