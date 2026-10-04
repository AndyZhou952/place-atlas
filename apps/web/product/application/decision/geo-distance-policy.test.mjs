import assert from 'node:assert/strict';
import test from 'node:test';

import { distanceInKm } from './geo-distance-policy.ts';

test('one Decision Support distance policy supplies stable great-circle distance', () => {
  assert.equal(
    distanceInKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }),
    0,
  );
  assert.ok(
    Math.abs(
      distanceInKm(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ) - 111.1949266,
    ) < 0.000001,
  );
});
