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
  assert.equal(report.safetyViolationCases, 0);
  assert.equal(predictions[0].recommendations[0].routeClaim, undefined);
  assert.ok(
    predictions[0].recommendations[0].reasonFacts.some(
      (fact) => fact.kind === 'distance' && fact.meters === 900,
    ),
  );
});
