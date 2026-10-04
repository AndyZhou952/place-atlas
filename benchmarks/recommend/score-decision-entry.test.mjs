import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { scoreRecommendDecision } from './score-decision.mjs';

const dataset = JSON.parse(
  readFileSync(new URL('./decision-entry.v1.json', import.meta.url), 'utf8'),
);

function oracle(entry) {
  if (entry.gold.action !== 'recommend')
    return {
      caseId: entry.caseId,
      action: entry.gold.action,
      recommendations: [],
      warnings: [],
    };
  const itemId = entry.gold.topItemIds[0];
  const item = dataset.catalog.find((candidate) => candidate.id === itemId);
  return {
    caseId: entry.caseId,
    action: 'recommend',
    warnings: entry.gold.requiredWarnings,
    recommendations: [
      {
        itemId,
        detailTargetId: itemId,
        reason: 'Saved cafe with disclosed entry uncertainty.',
        reasonFacts: [
          { kind: 'saved', value: true },
          { kind: 'food', value: 'coffee' },
          { kind: 'area', value: 'area-a' },
          ...(entry.input.intent.askWalkIn
            ? [
                item.walkIn === 'known'
                  ? { kind: 'walk_in_known', value: true }
                  : { kind: 'entry_unknown', value: true },
              ]
            : []),
        ],
      },
    ],
  };
}

test('entry-policy extension has a complete independent oracle', () => {
  const report = scoreRecommendDecision(dataset, {
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map(oracle),
  });
  assert.equal(report.cases, 4);
  assert.equal(report.casePassRate, 1);
  assert.equal(report.safetyViolationCases, 0);
});

test('an advance-booking venue cannot pass a walk-in request', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'known-rule-preferred-over-unvisited-unknown',
  );
  const prediction = oracle(entry);
  prediction.recommendations[0].itemId = 'saved-advance';
  prediction.recommendations[0].detailTargetId = 'saved-advance';
  const report = scoreRecommendDecision(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.ok(
    report.results[0].failures.includes('walk_in_constraint_violation'),
  );
});

test('unknown access cannot pass as a sourced walk-in claim', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'unknown-rule-is-labelled-fallback',
  );
  const prediction = oracle(entry);
  prediction.recommendations[0].reasonFacts = [
    { kind: 'food', value: 'coffee' },
    { kind: 'walk_in_known', value: true },
  ];
  prediction.warnings = ['current_availability_unknown'];
  const report = scoreRecommendDecision(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.ok(report.results[0].failures.includes('unsupported_reason_fact'));
  assert.ok(report.results[0].failures.includes('unknown_entry_not_disclosed'));
});
