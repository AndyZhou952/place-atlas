import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { scoreNearby } from './score-nearby.mjs';

const gold = JSON.parse(
  await readFile(new URL('./nearby-gold.v1.json', import.meta.url), 'utf8'),
);
// Test oracle ONLY: never use these generated answers as model predictions.
function oracle() {
  return {
    datasetId: gold.datasetId,
    predictions: gold.cases.map((c) => ({
      caseId: c.caseId,
      action: c.gold.action,
      itemIds: c.gold.itemIds,
      warnings: c.gold.requiredWarnings,
      ...(c.gold.action === 'clarify'
        ? { question: 'Which city or station?' }
        : {}),
      routeClaims: c.gold.requiredWarnings.includes('unverified_travel_time')
        ? []
        : c.gold.itemIds.flatMap((id) => {
            const route = c.input.routes.find(
              (r) =>
                r.itemId === id &&
                (r.mode === 'walk'
                  ? r.seconds <= 900
                  : r.doorToDoor && r.transfers === 0 && r.seconds <= 1200),
            );
            return route
              ? [{ itemId: id, mode: route.mode, seconds: route.seconds }]
              : [];
          }),
    })),
  };
}
test('all 14 synthetic policy cases have a satisfiable scoring contract', () => {
  const report = scoreNearby(gold, oracle());
  assert.equal(report.cases, 14);
  assert.equal(report.passes, true);
});
test('missing cases cannot inflate pass rate', () => {
  const predictions = oracle();
  predictions.predictions.pop();
  assert.equal(scoreNearby(gold, predictions).passes, false);
});
test('invented walking time, unsaved places, and missing warnings fail', () => {
  for (const mutate of [
    (p) => (p.predictions[0].routeClaims[0].seconds = 120),
    (p) => (p.predictions[0].itemIds = ['outside-catalog']),
    (p) =>
      (p.predictions.find((c) => c.caseId === 'distance-fallback').warnings =
        []),
    (p) =>
      (p.predictions.find((c) => c.caseId === 'ambiguous-origin').question =
        ''),
    (p) =>
      (p.predictions.find((c) => c.caseId === 'geocoder-down').action =
        'no_results'),
  ]) {
    const p = oracle();
    mutate(p);
    assert.equal(scoreNearby(gold, p).passes, false);
  }
});
test('malformed, duplicate and unknown outputs are rejected', () => {
  for (const mutate of [
    (p) => p.predictions.push(p.predictions[0]),
    (p) => (p.predictions[0].caseId = 'unknown-case'),
    (p) => (p.predictions[0].routeClaims[0].seconds = '600'),
  ]) {
    const p = oracle();
    mutate(p);
    assert.throws(() => scoreNearby(gold, p));
  }
});
