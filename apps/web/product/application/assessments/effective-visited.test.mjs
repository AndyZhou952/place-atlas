import assert from 'node:assert/strict';
import test from 'node:test';

import { isEffectivelyVisited } from './effective-visited.ts';

test('effective visited is manualVisited OR Visit count', () => {
  assert.equal(isEffectivelyVisited(false, 0), false);
  assert.equal(isEffectivelyVisited(false, 1), true);
  assert.equal(isEffectivelyVisited(true, 0), true);
  assert.equal(isEffectivelyVisited(true, 2), true);
});
