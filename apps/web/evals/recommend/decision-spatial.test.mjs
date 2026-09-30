import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decideRecommend } from '../../product/application/decision/recommend-decision.ts';
import { scoreRecommendDecision } from './score-decision.mjs';

const dataset = JSON.parse(
  readFileSync(new URL('./decision-spatial.v1.json', import.meta.url), 'utf8'),
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
  assert.equal(
    byCase.get('default-nearby-prefers-walking').recommendations[0].routeClaim
      .mode,
    'walk',
  );
  assert.equal(
    byCase.get('default-nearby-direct-train-fallback').recommendations[0]
      .routeClaim.mode,
    'transit',
  );
  assert.equal(
    byCase.get('default-nearby-distance-fallback').recommendations[0]
      .routeClaim,
    undefined,
  );
  assert.equal(
    byCase.get('explicit-walk-limit-has-no-broader-fallback').action,
    'no_results',
  );
});

test('a fallback flag cannot bypass a different explicit time limit', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'default-nearby-direct-train-fallback',
  );
  const prediction = {
    caseId: entry.caseId,
    ...decideRecommend(entry.input, dataset.catalog),
  };
  const constrained = {
    ...entry,
    input: {
      ...entry.input,
      intent: { ...entry.input.intent, maxMinutes: 10 },
    },
  };
  const report = scoreRecommendDecision(
    { ...dataset, cases: [constrained] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.ok(report.results[0].failures.includes('unsupported_route_claim'));
  assert.equal(
    decideRecommend(constrained.input, dataset.catalog).action,
    'no_results',
  );
});
