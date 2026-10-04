import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { scoreRatingCompletion } from './score-rating-completion.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const benchmark = JSON.parse(
  await readFile(
    join(directory, 'rating-completion-benchmark.v1.json'),
    'utf8',
  ),
);

function perfectPredictions() {
  return {
    predictions: benchmark.cases.map((entry) =>
      entry.scenario === 'accessible_positive'
        ? {
            caseId: entry.caseId,
            state: 'known',
            aggregateScore: entry.expected.aggregateScore,
            identityId: entry.identityId,
            branchId: entry.branchId,
            evidence: {
              provider: entry.evidence.provider,
              sourceUrl: entry.evidence.sourceUrl,
              observedAt: entry.evidence.observedAt,
            },
          }
        : { caseId: entry.caseId, state: 'unknown' },
    ),
  };
}

test('curated benchmark has 5-12 cases and perfect fixture passes', () => {
  const report = scoreRatingCompletion(benchmark, perfectPredictions());
  assert.equal(benchmark.cases.length, 9);
  assert.equal(report.counts.accessiblePositives, 5);
  assert.equal(report.metrics.completionCoverage, 1);
  assert.equal(report.metrics.exactClaimAccuracy, 1);
  assert.equal(report.metrics.provenanceCompleteness, 1);
  assert.equal(report.metrics.safeFailureRate, 1);
  assert.equal(report.passes, true);
});

test('unknown-only output fails accessible-positive completion', () => {
  const predictions = {
    predictions: benchmark.cases.map((entry) => ({
      caseId: entry.caseId,
      state: 'unknown',
    })),
  };
  const report = scoreRatingCompletion(benchmark, predictions);
  assert.equal(report.metrics.completionCoverage, 0);
  assert.equal(report.passes, false);
});

test('reviewer score cannot replace aggregate score', () => {
  const predictions = perfectPredictions();
  const prediction = predictions.predictions.find(
    (entry) => entry.caseId === 'rating-frozen-reviewer-vs-aggregate-kabuto',
  );
  prediction.aggregateScore = 4.5;
  const report = scoreRatingCompletion(benchmark, predictions);
  assert.equal(report.passes, false);
  assert.ok(
    report.failures.some((failure) => failure.caseId === prediction.caseId),
  );
});

test('synthetic blocked and wrong-branch controls require unknown', () => {
  const predictions = perfectPredictions();
  const blocked = predictions.predictions.find(
    (entry) => entry.caseId === 'rating-synthetic-provider-blocked',
  );
  blocked.state = 'known';
  blocked.aggregateScore = 3.8;
  const report = scoreRatingCompletion(benchmark, predictions);
  assert.equal(report.passes, false);
  assert.equal(report.metrics.safeFailureRate, 0.75);
});

test('missing, duplicate and invalid predictions are rejected instead of dropped', () => {
  const missing = perfectPredictions();
  missing.predictions.pop();
  assert.throws(() => scoreRatingCompletion(benchmark, missing), /every case/u);
  const duplicate = perfectPredictions();
  duplicate.predictions.push(duplicate.predictions[0]);
  assert.throws(
    () => scoreRatingCompletion(benchmark, duplicate),
    /duplicate/u,
  );
  const invalid = perfectPredictions();
  invalid.predictions[0].state = 'pending';
  assert.throws(() => scoreRatingCompletion(benchmark, invalid), /state/u);
  invalid.predictions[0].state = 'unknown';
  assert.throws(
    () => scoreRatingCompletion(benchmark, invalid),
    /cannot include/u,
  );
});

test('wrong branch, missing citation and old observation cannot pass', () => {
  for (const change of [
    (p) => {
      p.branchId = 'different-branch';
    },
    (p) => {
      delete p.evidence;
    },
    (p) => {
      p.evidence.observedAt = '2025-01-01';
    },
  ]) {
    const predictions = perfectPredictions();
    change(predictions.predictions[0]);
    assert.equal(scoreRatingCompletion(benchmark, predictions).passes, false);
  }
});
