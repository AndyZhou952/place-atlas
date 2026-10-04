import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMarkerPlan, markerDiff } from './map-marker-plan.ts';

const place = (id, title = id) => ({
  id,
  kind: 'food',
  title,
  latitude: 35.68,
  longitude: 139.76,
});

test('offsets collocated markers deterministically', () => {
  const plan = buildMarkerPlan([place('a'), place('b')]);
  assert.equal(plan[0].latitude, 35.68);
  assert.equal(plan[1].latitude, 35.68018);
});

test('reconciles only added, changed, and removed markers', () => {
  const initial = buildMarkerPlan([place('a'), place('b')]);
  const current = new Map(
    initial.map((entry) => [entry.item.id, entry.signature]),
  );
  const next = buildMarkerPlan([place('a'), place('b', 'changed'), place('c')]);
  const diff = markerDiff(current, next);
  assert.deepEqual(diff.remove, []);
  assert.deepEqual(
    diff.upsert.map((entry) => entry.item.id),
    ['b', 'c'],
  );

  assert.deepEqual(markerDiff(current, buildMarkerPlan([place('a')])).remove, [
    'b',
  ]);
});
