import assert from 'node:assert/strict';
import test from 'node:test';

import { createGoogleLocationResolver } from './google-location-resolver.ts';

test('Google geocoding converts gateway failures into a stable unresolved state', async () => {
  const resolver = createGoogleLocationResolver({
    gateway: {
      async invoke() {
        throw new Error('secret transport detail');
      },
    },
    estimatedCostUsd: 0.005,
    clock: () => new Date('2026-09-13T12:00:00.000Z'),
  });

  const result = await resolver.resolve('銀座');

  assert.deepEqual(result, {
    status: 'unresolved',
    reason: 'dependency_failure',
    warning: 'Address lookup is temporarily unavailable.',
  });
});
