import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { scoreRecommendIntent } from './score-intent.mjs';

const dataset = JSON.parse(
  readFileSync(new URL('./intent-gold.v1.json', import.meta.url), 'utf8'),
);

test('curated intent cases and deterministic oracle are internally consistent', () => {
  const predictions = {
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map(({ caseId, gold }) => ({
      caseId,
      ...gold,
      ...(gold.action === 'clarify'
        ? { question: 'Which starting point?' }
        : {}),
    })),
  };
  const report = scoreRecommendIntent(dataset, predictions);
  assert.equal(report.cases, 34);
  assert.equal(report.casePassRate, 1);
  assert.equal(report.safetyViolationCases, 0);
});

test('wrong branches, invented origins and route claims fail independently', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'area-walk-needs-start',
  );
  const report = scoreRecommendIntent(
    { ...dataset, cases: [entry] },
    {
      datasetId: dataset.datasetId,
      predictions: [
        {
          caseId: entry.caseId,
          ...entry.gold,
          action: 'recommend',
          originId: 'station:invented',
          routeClaims: [{ seconds: 600 }],
        },
      ],
    },
  );
  assert.deepEqual(report.results[0].failures, [
    'wrong_action',
    'wrong_origin',
    'invented_origin',
    'premature_restaurant_or_route_claim',
  ]);
  assert.equal(report.safetyViolationCases, 1);
});
