import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { scoreNearbyLocation } from './score-nearby-location.mjs';

const gold = JSON.parse(
  await readFile(
    new URL('./nearby-location-gold.v1.json', import.meta.url),
    'utf8',
  ),
);

// Scorer contract only; these gold-derived answers are never model predictions.
function oracle() {
  return {
    datasetId: gold.datasetId,
    predictions: gold.cases.map((entry) => ({
      caseId: entry.caseId,
      ...entry.gold,
      ...(entry.gold.action === 'clarify'
        ? { question: 'Which station do you mean?' }
        : {}),
    })),
  };
}

test('verified station cases have a satisfiable scoring contract', () => {
  const report = scoreNearbyLocation(gold, oracle());
  assert.equal(report.cases, 10);
  assert.equal(report.actionAccuracy, 1);
  assert.equal(report.passes, true);
});

test('location confusion and invented origins fail', () => {
  for (const mutate of [
    (p) => (p.predictions[0].originId = 'tokyo-metro:higashi-ikebukuro'),
    (p) => (p.predictions[0].originId = 'invented-station'),
    (p) => (p.predictions[0].visited = 'only_visited'),
    (p) => (p.predictions[0].routeClaims = [{ seconds: 600 }]),
    (p) => {
      const ambiguous = p.predictions.find(
        (entry) => entry.caseId === 'ikebukuro-or-east-zh',
      );
      ambiguous.action = 'resolve';
      ambiguous.originId = 'tokyo-metro:ikebukuro';
    },
    (p) =>
      (p.predictions.find((entry) => entry.action === 'clarify').question = ''),
  ]) {
    const predictions = oracle();
    mutate(predictions);
    assert.equal(scoreNearbyLocation(gold, predictions).passes, false);
  }
});

test('missing and duplicate predictions cannot pass', () => {
  const missing = oracle();
  missing.predictions.pop();
  assert.equal(scoreNearbyLocation(gold, missing).passes, false);
  const duplicate = oracle();
  duplicate.predictions.push(duplicate.predictions[0]);
  assert.throws(() => scoreNearbyLocation(gold, duplicate));
});
