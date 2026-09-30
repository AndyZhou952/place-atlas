import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { normalizeRecommendIntent } from '../../product/application/decision/recommend-intent.ts';

const dataset = JSON.parse(
  readFileSync(new URL('./intent-proximity.v2.json', import.meta.url), 'utf8'),
);

test('proximity and explicit travel policy survives adversarial model predictions', () => {
  assert.equal(dataset.datasetId, 'recommend-intent-proximity-v2');
  assert.equal(new Set(dataset.cases.map(({ caseId }) => caseId)).size, 7);
  for (const entry of dataset.cases) {
    const actual = normalizeRecommendIntent(
      entry.messages,
      entry.options ?? [],
      entry.modelPrediction,
    );
    for (const [field, expected] of Object.entries(entry.expected))
      assert.deepEqual(actual[field], expected, `${entry.caseId}: ${field}`);
  }
});
