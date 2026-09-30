import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { scoreRecommendIntent } from './score-intent.mjs';

const dataset = JSON.parse(
  readFileSync(new URL('./dialogue-gold.v1.json', import.meta.url), 'utf8'),
);

test('clarification continuation cases preserve and update the intended constraints', () => {
  const report = scoreRecommendIntent(dataset, {
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map(({ caseId, gold }) => ({
      caseId,
      ...gold,
      ...(gold.action === 'clarify'
        ? { question: 'Which exact starting point?' }
        : {}),
    })),
  });
  assert.equal(report.cases, 8);
  assert.equal(report.casePassRate, 1);
});
