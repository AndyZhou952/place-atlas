import assert from 'node:assert/strict';
import test from 'node:test';

import { isJapanTransitArea } from './transit-coverage.ts';

test('Japan transit coverage gate includes major rail regions and excludes nearby foreign cities', () => {
  for (const point of [
    { latitude: 35.672, longitude: 139.764 },
    { latitude: 34.694, longitude: 135.503 },
    { latitude: 33.59, longitude: 130.401 },
    { latitude: 43.062, longitude: 141.354 },
    { latitude: 26.212, longitude: 127.681 },
  ])
    assert.equal(isJapanTransitArea(point), true);
  for (const point of [
    { latitude: 35.18, longitude: 129.075 },
    { latitude: 37.566, longitude: 126.978 },
    { latitude: 25.033, longitude: 121.565 },
    { latitude: 38.722, longitude: -9.139 },
  ])
    assert.equal(isJapanTransitArea(point), false);
});
