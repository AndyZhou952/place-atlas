// Scores real discover responses without putting gold identities into requests.
// This is a candidate-retrieval score, not a post-selection research score.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const identitySignatures = {
  'mendokoro-tenho-nakano-sakaue': ['メンドコロ天鳳', '164-0011'],
  'tokyo-mentsudan-shinjuku': ['mentsudan', '160-0023'],
  'koffee-mameya-kakeru-koto': ['koffee mameya kakeru', '135-0023'],
  'katsuretsu-yotsuya-takeda': ['takeda', '160-0004'],
  'ebimaru-jimbocho': ['ebimaru ramen', '101-0065'],
  'spicy-curry-roka-okubo': ['spicy curry roka', '169-0073'],
  'gancon-noodle-komagome': ['gancon noodle', '114-0015'],
  'aldebaran-azabu-juban': ['aldebaran', '106-0045'],
  'kabuto-ikebukuro': ['kabuto', '171-0014'],
  'yardbird-sheung-wan': ['yardbird', '154-158 wing lok'],
  'dishoom-covent-garden': ['dishoom', '12 upper st martin'],
  'superiority-burger-east-village': ['superiority burger', '119 avenue a'],
  'ho-lee-fook-central': ['ho lee fook', 'elgin st'],
};

function fold(value) {
  return (
    value
      .normalize('NFKD')
      // Preserve Japanese dakuten/handakuten; stripping every combining mark
      // changes voiced kana into different characters, incorrectly rejecting valid candidates.
      .replace(/(?<![\p{Script=Hiragana}\p{Script=Katakana}])\p{M}/gu, '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[’']/gu, '')
      .replace(/\s+/gu, ' ')
  );
}

function matchesIdentity(candidate, identityId) {
  const signature = identitySignatures[identityId];
  assert.ok(signature, `Missing independent signature for ${identityId}`);
  const text = fold(
    `${candidate.transientName ?? ''} ${candidate.transientAddress ?? ''}`,
  );
  return signature.every((part) => text.includes(part));
}

export function scoreLiveDiscovery(gold, run) {
  assert.equal(run.datasetId, gold.datasetId);
  const observations = new Map(
    run.observations.map((entry) => [entry.caseId, entry]),
  );
  assert.equal(
    observations.size,
    gold.cases.length,
    'Run must include all cases',
  );
  const cases = gold.cases.map(({ caseId, gold: expected }) => {
    const observed = observations.get(caseId);
    assert.ok(observed, `Missing observation for ${caseId}`);
    assert.ok(
      Array.isArray(observed.candidates),
      `${caseId} needs candidate output`,
    );
    const candidates = observed.candidates ?? [];
    const resolved =
      expected.expectedAction === 'resolve'
        ? candidates.findIndex((candidate) =>
            matchesIdentity(candidate, expected.identityId),
          )
        : -1;
    const passed =
      observed.httpStatus === 200 &&
      (expected.expectedAction === 'resolve'
        ? observed.status === 'candidates_ready' &&
          resolved >= 0 &&
          resolved < 3
        : expected.expectedAction === 'clarify'
          ? observed.status === 'candidates_ready' &&
            candidates.length >= 2 &&
            candidates.length <= 3
          : observed.status === 'clarification_required' &&
            candidates.length === 0);
    return {
      caseId,
      expectedAction: expected.expectedAction,
      passed,
      candidates: candidates.length,
      ...(expected.expectedAction === 'resolve'
        ? { targetRank: resolved < 0 ? null : resolved + 1 }
        : {}),
      latencyMs: observed.latencyMs,
    };
  });
  const count = (action, passed) =>
    cases.filter(
      (entry) => entry.expectedAction === action && entry.passed === passed,
    ).length;
  const total = cases.length;
  const passed = cases.filter((entry) => entry.passed).length;
  return {
    datasetId: gold.datasetId,
    runAt: run.runAt,
    scope: 'candidate retrieval only; owner still selects before research',
    total,
    passed,
    passRate: passed / total,
    resolve: {
      passed: count('resolve', true),
      failed: count('resolve', false),
    },
    clarify: {
      passed: count('clarify', true),
      failed: count('clarify', false),
    },
    noMatch: {
      passed: count('no_match', true),
      failed: count('no_match', false),
    },
    cases,
  };
}

if (process.argv[1]?.endsWith('/score-live-discovery.mjs')) {
  const [goldPath, runPath] = process.argv.slice(2);
  if (!goldPath || !runPath) {
    throw new Error('Usage: node score-live-discovery.mjs GOLD.json RUN.json');
  }
  const gold = JSON.parse(await readFile(goldPath, 'utf8'));
  const run = JSON.parse(await readFile(runPath, 'utf8'));
  const report = scoreLiveDiscovery(gold, run);
  console.log(JSON.stringify(report, null, 2));
  if (report.passed !== report.total) process.exitCode = 1;
}
