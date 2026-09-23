import assert from 'node:assert/strict';
import test from 'node:test';

import { googleRouteMatrixResponseFixture } from './fixtures/google-route-matrix-response.fixture.mjs';
import { mapGoogleRouteMatrixResponse } from './google-route-matrix-response-mapper.ts';

test('Google Route Matrix maps unordered indexed elements and fails closed per unavailable route', () => {
  assert.deepEqual(
    mapGoogleRouteMatrixResponse(googleRouteMatrixResponseFixture, 3),
    {
      routeDurationSeconds: [600, null, 901],
      routeDistanceMeters: [650, null, 1200],
    },
  );
});
