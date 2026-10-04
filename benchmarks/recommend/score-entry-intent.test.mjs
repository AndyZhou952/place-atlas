import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { predictEntryIntent, scoreEntryIntent } from './score-entry-intent.mjs';

const dataset = JSON.parse(
  readFileSync(new URL('./intent-entry.v1.json', import.meta.url), 'utf8'),
);

test('entry wording extension passes the production intent guard', () => {
  const report = scoreEntryIntent(dataset, predictEntryIntent(dataset));
  assert.equal(report.cases, 5);
  assert.equal(report.casePassRate, 1);
  assert.equal(report.passes, true);
});

test('an entry assertion for a timed walk fails independently', () => {
  const predictionFile = predictEntryIntent(dataset);
  predictionFile.predictions[1].askWalkIn = true;
  const report = scoreEntryIntent(dataset, predictionFile);
  assert.equal(report.passes, false);
  assert.deepEqual(report.results[1].failures, ['wrong_askWalkIn']);
});

test('a missing case cannot inflate the pass rate', () => {
  const predictionFile = predictEntryIntent(dataset);
  predictionFile.predictions.pop();
  const report = scoreEntryIntent(dataset, predictionFile);
  assert.equal(report.passes, false);
  assert.deepEqual(report.results.at(-1).failures, ['missing_prediction']);
});

test('production prediction does not read the expected answer', () => {
  const altered = structuredClone(dataset);
  altered.cases[0].expected.askWalkIn = false;
  assert.deepEqual(predictEntryIntent(altered), predictEntryIntent(dataset));
  assert.equal(
    scoreEntryIntent(altered, predictEntryIntent(altered)).passes,
    false,
  );
});
