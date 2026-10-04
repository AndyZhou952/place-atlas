import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreLiveRating } from './score-live-rating.mjs';

const dataset = {
  benchmarkId: 'sample',
  checkedAt: '2026-09-28',
  cases: [
    {
      caseId: 'branch',
      mode: 'live_verified',
      expected: { aggregateScore: 3.71 },
      evidence: {
        sourceUrl: 'https://tabelog.com/tokyo/A1309/A130902/13131643/',
        observedAt: '2026-09-28T01:00:00Z',
      },
    },
  ],
};
const observed = {
  caseId: 'branch',
  discoveryHttpStatus: 200,
  candidateCount: 1,
  researchHttpStatus: 200,
  researchStatus: 'preview_ready',
  tabelog: {
    status: 'known',
    score: 3.71,
    url: dataset.cases[0].evidence.sourceUrl,
    provenance: 'agent_observed',
    observedAt: '2026-09-28T01:02:00Z',
  },
  cancelled: true,
  latencyMs: 11000,
};

test('live rating requires exact branch source, score, day and cleanup', () => {
  const run = {
    benchmarkId: 'sample',
    runAt: '2026-09-28T01:03:00Z',
    observations: [observed],
  };
  assert.equal(scoreLiveRating(dataset, run).passed, 1);
  for (const change of [
    { tabelog: { ...observed.tabelog, score: 4.5 } },
    { tabelog: { ...observed.tabelog, url: 'https://tabelog.com/other/' } },
    { tabelog: { ...observed.tabelog, observedAt: '2025-01-01T00:00:00Z' } },
    { cancelled: false },
  ]) {
    assert.equal(
      scoreLiveRating(dataset, {
        ...run,
        observations: [{ ...observed, ...change }],
      }).passed,
      0,
    );
  }
});

test('missing live branches cannot pass', () => {
  assert.throws(
    () => scoreLiveRating(dataset, { benchmarkId: 'sample', observations: [] }),
    /Every live case must be run/,
  );
});
