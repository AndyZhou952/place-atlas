import assert from 'node:assert/strict';
import test from 'node:test';

import { createGoogleWalkingRouteMatrixProvider } from './google-walking-route-matrix-provider.ts';

test('Google walking RouteProvider keeps valid matrix elements while failing closed for an unavailable route', async () => {
  const provider = createGoogleWalkingRouteMatrixProvider({
    gateway: gatewayReturning({
      routeDurationSeconds: [600, null],
      routeDistanceMeters: [650, null],
    }),
    maximumDestinationsPerBatch: 2,
    estimatedCostUsdPerElement: 0.005,
    clock: () => new Date('2026-09-15T12:00:00.000Z'),
  });
  const origin = { latitude: 35.6717, longitude: 139.765 };

  const results = await Promise.all([
    provider.walking(origin, { latitude: 35.672, longitude: 139.766 }),
    provider.walking(origin, { latitude: 35.673, longitude: 139.767 }),
  ]);

  assert.equal(results[0].status, 'fresh');
  assert.deepEqual(results[1], {
    status: 'unavailable',
    warning: 'Live walking route is temporarily unavailable.',
  });
});

const attribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation/routes',
};

function gatewayReturning(fields) {
  return {
    async invoke() {
      return {
        ok: true,
        value: {
          providerId: 'google-maps-platform',
          policyVersion: 'google-fixture-v1',
          sourceUrl:
            'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
          fields,
          attribution,
          cache: { mode: 'request_only' },
        },
      };
    },
  };
}
