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
const entryDataset = JSON.parse(
  readFileSync(
    new URL('../../../evals/recommend/decision-entry.v1.json', import.meta.url),
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

test('an average route is disclosed in both the reason and route claim', () => {
  const result = decideRecommend(
    {
      intent: {
        foodTerms: [],
        excludedFoodTerms: [],
        travelMode: 'transit',
        maxMinutes: 20,
        visited: 'prefer_unvisited',
      },
      origin: { state: 'resolved', id: 'station' },
      catalogIds: ['saved'],
      routes: [
        {
          itemId: 'saved',
          mode: 'transit',
          seconds: 1080,
          status: 'fresh',
          transfers: 0,
          doorToDoor: true,
          estimateBasis: 'average',
        },
      ],
      distances: [],
    },
    [
      {
        id: 'saved',
        kind: 'food',
        verificationStatus: 'verified',
        title: 'Saved Restaurant',
        area: 'Tokyo',
        address: 'Stored address',
        tags: ['cafe'],
        visited: false,
      },
    ],
  );
  assert.equal(result.action, 'recommend');
  assert.match(result.recommendations[0].reason, /estimated direct train/u);
  assert.equal(result.recommendations[0].routeClaim.estimateBasis, 'average');
});
