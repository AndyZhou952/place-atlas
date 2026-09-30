import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decideRecommend } from '../../product/application/decision/recommend-decision.ts';
import { scoreRecommendDecision } from './score-decision.mjs';

const dataset = JSON.parse(
  readFileSync(new URL('./decision-spatial.json', import.meta.url), 'utf8'),
);

test('resolved-origin recommendations use nearby saved IDs and label straight-line evidence', () => {
  const predictions = dataset.cases.map(({ caseId, input }) => ({
    caseId,
    ...decideRecommend(input, dataset.catalog),
  }));
  const report = scoreRecommendDecision(dataset, {
    datasetId: dataset.datasetId,
    predictions,
  });
  assert.equal(report.casePassRate, 1);
  assert.equal(report.cases, 6);
  assert.equal(report.safetyViolationCases, 0);
  assert.equal(predictions[0].recommendations[0].routeClaim, undefined);
  assert.ok(
    predictions[0].recommendations[0].reasonFacts.some(
      (fact) => fact.kind === 'distance' && fact.meters === 900,
    ),
  );
  const byCase = new Map(
    predictions.map((prediction) => [prediction.caseId, prediction]),
  );
  for (const caseId of [
    'distance-default-ignores-walking-route',
    'distance-default-ignores-train-route',
    'distance-default-uses-geodesic-without-route',
  ]) {
    assert.equal(byCase.get(caseId).recommendations[0].routeClaim, undefined);
    assert.ok(byCase.get(caseId).warnings.includes('unverified_travel_time'));
  }
  assert.equal(
    byCase.get('explicit-walk-limit-has-no-broader-fallback').action,
    'no_results',
  );
});

test('a route claim is rejected when no travel mode was requested', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'distance-default-ignores-train-route',
  );
  const actual = decideRecommend(entry.input, dataset.catalog);
  const prediction = { caseId: entry.caseId, ...actual };
  prediction.recommendations = [
    {
      ...actual.recommendations[0],
      routeClaim: { mode: 'transit', seconds: 1080 },
    },
  ];
  const report = scoreRecommendDecision(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.ok(report.results[0].failures.includes('unsupported_route_claim'));
});
