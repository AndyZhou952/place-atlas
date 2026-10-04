import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { scoreRecommendDecision } from './score-decision.mjs';

const dataset = JSON.parse(
  readFileSync(new URL('./decision-gold.v1.json', import.meta.url), 'utf8'),
);

function oracle(entry) {
  const { gold, input } = entry;
  if (gold.action !== 'recommend')
    return {
      caseId: entry.caseId,
      action: gold.action,
      recommendations: [],
      warnings: gold.requiredWarnings,
      ...(gold.action === 'clarify' ? { question: 'Which exact point?' } : {}),
    };
  const itemId = gold.topItemIds[0];
  const item = dataset.catalog.find((candidate) => candidate.id === itemId);
  const route = input.routes.find(
    (candidate) =>
      candidate.itemId === itemId &&
      candidate.status === 'fresh' &&
      (input.intent.travelMode === 'either' ||
        candidate.mode === input.intent.travelMode) &&
      candidate.seconds <= (input.intent.maxMinutes ?? 20) * 60,
  );
  const routeClaim = route
    ? { mode: route.mode, seconds: route.seconds }
    : undefined;
  const reasonFacts = [];
  if (input.intent.foodTerms.length)
    reasonFacts.push({ kind: 'food', value: input.intent.foodTerms[0] });
  if (input.origin.state === 'area')
    reasonFacts.push({ kind: 'area', value: item.area });
  if (routeClaim)
    reasonFacts.push({ kind: routeClaim.mode, seconds: routeClaim.seconds });
  if (
    !routeClaim &&
    input.origin.state === 'resolved' &&
    input.intent.travelMode !== 'none'
  )
    reasonFacts.push({
      kind: 'distance',
      meters: input.distances.find((candidate) => candidate.itemId === itemId)
        .meters,
    });
  if (!reasonFacts.length) reasonFacts.push({ kind: 'saved', value: true });
  return {
    caseId: entry.caseId,
    action: 'recommend',
    warnings: gold.requiredWarnings,
    recommendations: [
      {
        itemId,
        detailTargetId: itemId,
        reason: 'This saved restaurant matches your request.',
        reasonFacts,
        ...(routeClaim ? { routeClaim } : {}),
      },
    ],
  };
}

test('curated decision cases and independent verifier accept a complete oracle', () => {
  const report = scoreRecommendDecision(dataset, {
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map(oracle),
  });
  assert.equal(report.cases, 21);
  assert.equal(report.casePassRate, 1);
  assert.equal(report.safetyViolationCases, 0);
});

test('an unverified result fails the saved-catalog boundary', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'unverified-distractor',
  );
  const report = scoreRecommendDecision(
    { ...dataset, cases: [entry] },
    {
      datasetId: dataset.datasetId,
      predictions: [
        {
          caseId: entry.caseId,
          action: 'recommend',
          warnings: [],
          recommendations: [
            {
              itemId: 'unverified-sushi',
              detailTargetId: 'sushi-ginza',
              reason: 'Good sushi.',
              reasonFacts: [{ kind: 'food', value: 'sushi' }],
            },
          ],
        },
      ],
    },
  );
  assert.ok(report.results[0].failures.includes('wrong_selection'));
  assert.ok(
    report.results[0].failures.includes('unsaved_or_unverified_restaurant'),
  );
  assert.equal(report.safetyViolationCases, 1);
});

test('a recommendation cannot open the detail of another restaurant', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'area-sushi-no-time',
  );
  const prediction = oracle(entry);
  prediction.recommendations[0].detailTargetId = 'ramen-a';
  const report = scoreRecommendDecision(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.ok(report.results[0].failures.includes('wrong_detail_target'));
});
