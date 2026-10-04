import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { scoreRecommendDecision } from '../../../../../benchmarks/recommend/score-decision.mjs';
import { decideRecommend } from './recommend-decision.ts';

const dataset = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../benchmarks/recommend/decision-gold.v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const entryDataset = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../benchmarks/recommend/decision-entry.v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

test('deterministic decision gates pass all saved-catalog benchmark cases', () => {
  const report = scoreRecommendDecision(dataset, {
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map((entry) => ({
      caseId: entry.caseId,
      ...decideRecommend(entry.input, dataset.catalog),
    })),
  });
  assert.equal(report.cases, 21);
  assert.deepEqual(
    report.results.filter((entry) => !entry.passed),
    [],
  );
  assert.equal(report.safetyViolationCases, 0);
});

test('entry-policy decisions pass the separate walk-in extension', () => {
  const report = scoreRecommendDecision(entryDataset, {
    datasetId: entryDataset.datasetId,
    predictions: entryDataset.cases.map((entry) => ({
      caseId: entry.caseId,
      ...decideRecommend(entry.input, entryDataset.catalog),
    })),
  });
  assert.equal(report.cases, 4);
  assert.deepEqual(
    report.results.filter((entry) => !entry.passed),
    [],
  );
  assert.equal(report.safetyViolationCases, 0);
});
