import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { scoreRecommendDecision } from '../../../evals/recommend/score-decision.mjs';
import { decideRecommend } from './recommend-decision.ts';

const dataset = JSON.parse(
  readFileSync(
    new URL('../../../evals/recommend/decision-gold.v1.json', import.meta.url),
    'utf8',
  ),
);

test('deterministic decision gates pass all frozen saved-catalog cases', () => {
  const report = scoreRecommendDecision(dataset, {
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map((entry) => ({
      caseId: entry.caseId,
      ...decideRecommend(entry.input, dataset.catalog),
    })),
  });
  assert.equal(report.cases, 26);
  assert.deepEqual(
    report.results.filter((entry) => !entry.passed),
    [],
  );
  assert.equal(report.safetyViolationCases, 0);
});
