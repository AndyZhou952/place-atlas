import assert from 'node:assert/strict';
import test from 'node:test';

import { createGoogleWalkingRouteMatrixProvider } from './google-walking-route-matrix-provider.ts';

test('Google walking RouteProvider refuses an oversized batch without provider egress', async () => {
  let gatewayCalls = 0;
  const provider = createGoogleWalkingRouteMatrixProvider({
    gateway: {
      async invoke() {
        gatewayCalls += 1;
        throw new Error('must not run');
      },
    },
    maximumDestinationsPerBatch: 2,
    estimatedCostUsdPerElement: 0.005,
    clock: () => new Date('2026-09-15T12:00:00.000Z'),
  });
  const origin = { latitude: 35.6717, longitude: 139.765 };

  const results = await Promise.all([
    provider.walking(origin, { latitude: 35.672, longitude: 139.766 }),
    provider.walking(origin, { latitude: 35.673, longitude: 139.767 }),
    provider.walking(origin, { latitude: 35.674, longitude: 139.768 }),
  ]);

  assert.equal(gatewayCalls, 0);
  assert.deepEqual(
    results.map(({ status }) => status),
    ['unavailable', 'unavailable', 'unavailable'],
  );
});

test('Google walking RouteProvider turns a whole-request provider failure into unavailable evidence', async () => {
  const provider = createGoogleWalkingRouteMatrixProvider({
    gateway: {
      async invoke() {
        return {
          ok: false,
          error: {
            kind: 'dependency_failure',
            message: 'provider detail must not escape',
          },
        };
      },
    },
    maximumDestinationsPerBatch: 2,
    estimatedCostUsdPerElement: 0.005,
    clock: () => new Date('2026-09-15T12:00:00.000Z'),
  });
  const origin = { latitude: 35.6717, longitude: 139.765 };

  const results = await Promise.all([
    provider.walking(origin, { latitude: 35.672, longitude: 139.766 }),
    provider.walking(origin, { latitude: 35.673, longitude: 139.767 }),
  ]);

  assert.deepEqual(results, [unavailable(), unavailable()]);
});

function unavailable() {
  return {
    status: 'unavailable',
    warning: 'Live walking route is temporarily unavailable.',
  };
}
