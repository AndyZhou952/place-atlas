import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreLiveDiscovery } from './score-live-discovery.mjs';

const gold = {
  datasetId: 'sample',
  cases: [
    {
      caseId: 'branch',
      gold: {
        expectedAction: 'resolve',
        identityId: 'superiority-burger-east-village',
      },
    },
    { caseId: 'ambiguous', gold: { expectedAction: 'clarify' } },
    { caseId: 'negative', gold: { expectedAction: 'no_match' } },
  ],
};

function observation(caseId, status, candidates) {
  return { caseId, httpStatus: 200, status, candidates, latencyMs: 100 };
}

test('live candidate scoring catches a wrong branch and unrelated no-match hit', () => {
  const run = {
    datasetId: 'sample',
    runAt: '2026-09-28T00:00:00Z',
    observations: [
      observation('branch', 'candidates_ready', [
        {
          transientName: 'Superiority Burger',
          transientAddress: 'Tokyo, Japan',
        },
      ]),
      observation('ambiguous', 'candidates_ready', [
        { transientName: 'AFURI Crossing', transientAddress: 'Roppongi 4' },
        { transientName: 'AFURI Hills', transientAddress: 'Roppongi 6' },
      ]),
      observation('negative', 'candidates_ready', [
        { transientName: 'Unrelated gyōza', transientAddress: 'Tokyo, Japan' },
      ]),
    ],
  };
  const report = scoreLiveDiscovery(gold, run);
  assert.equal(report.passed, 1);
  assert.equal(report.cases[0].targetRank, null);
  assert.deepEqual(report.noMatch, { passed: 0, failed: 1 });

  run.observations[0].candidates[0].transientAddress =
    '119 Avenue A, New York, NY';
  run.observations[2] = observation('negative', 'clarification_required', []);
  assert.equal(scoreLiveDiscovery(gold, run).passed, 3);
});

test('missing benchmark cases cannot inflate the live score', () => {
  assert.throws(
    () => scoreLiveDiscovery(gold, { datasetId: 'sample', observations: [] }),
    /Run must include all cases/,
  );
});

test('Japanese voiced kana survives live identity normalization', () => {
  const report = scoreLiveDiscovery(
    {
      datasetId: 'sample',
      cases: [
        {
          caseId: 'tenho',
          gold: {
            expectedAction: 'resolve',
            identityId: 'mendokoro-tenho-nakano-sakaue',
          },
        },
      ],
    },
    {
      datasetId: 'sample',
      runAt: '2026-09-28T00:00:00Z',
      observations: [
        observation('tenho', 'candidates_ready', [
          {
            transientName: 'メンドコロ天鳳',
            transientAddress: 'Japan, 〒164-0011 Tokyo, Nakano City',
          },
        ]),
      ],
    },
  );
  assert.equal(report.passed, 1);
});
