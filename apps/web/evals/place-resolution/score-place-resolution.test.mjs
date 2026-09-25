import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  scorePlaceResolution,
  validateGoldDataset,
} from './score-place-resolution.mjs';

const directory = dirname(fileURLToPath(import.meta.url));

async function readFixture(name) {
  return JSON.parse(await readFile(join(directory, name), 'utf8'));
}

test('the curated offline fixture passes every threshold', async () => {
  const gold = await readFixture('place-resolution-gold.v1.json');
  const predictions = await readFixture(
    'place-resolution-predictions.example.v1.json',
  );
  const report = scorePlaceResolution(gold, predictions);

  assert.equal(report.counts.total, 39);
  assert.deepEqual(report.counts, {
    total: 39,
    resolve: 27,
    clarify: 9,
    noMatch: 3,
  });
  assert.equal(report.passes, true);
  assert.equal(report.metrics.overallAccuracy, 1);
  assert.equal(report.metrics.top3TargetRecall, 1);
  assert.equal(report.metrics.clarificationUxAccuracy, 1);
  assert.equal(report.metrics.unsafeAutoResolveRate, 0);
  assert.deepEqual(report.byTag['short-message'], { count: 9, accuracy: 1 });
  assert.deepEqual(report.failures, []);

  const shortResolveCases = gold.cases.filter(
    (entry) =>
      entry.tags.includes('short-message') &&
      entry.gold.expectedAction === 'resolve',
  );
  assert.equal(shortResolveCases.length, 5);
  assert.equal(
    shortResolveCases.every((entry) => entry.gold.curationNote.length > 0),
    true,
  );
  const shortKabuto = gold.cases.find(
    (entry) => entry.caseId === 'short-ambiguous-kabuto',
  );
  assert.equal(shortKabuto.gold.expectedAction, 'clarify');
  assert.equal(shortKabuto.gold.sourceUrls.length, 2);
});

test('an arbitrary chain branch selection is unsafe and fails the gate', async () => {
  const gold = await readFixture('place-resolution-gold.v1.json');
  const predictions = await readFixture(
    'place-resolution-predictions.example.v1.json',
  );
  const unsafe = structuredClone(predictions);
  const prediction = unsafe.predictions.find(
    (entry) => entry.caseId === 'ambiguous-brand-torikizoku',
  );
  prediction.action = 'resolve';
  prediction.selectedIdentityId = 'invented-torikizoku-branch';
  delete prediction.clarification;

  const report = scorePlaceResolution(gold, unsafe);
  assert.equal(report.passes, false);
  assert.equal(report.metrics.unsafeAutoResolveRate, 0.0833);
  assert.equal(report.failures[0].caseId, 'ambiguous-brand-torikizoku');
});

test('gold validation rejects unresolved cases that omit an explanation', async () => {
  const gold = await readFixture('place-resolution-gold.v1.json');
  const invalid = structuredClone(gold);
  delete invalid.cases.find(
    (entry) => entry.caseId === 'ambiguous-afuri-roppongi',
  ).gold.clarificationReason;

  assert.throws(
    () => validateGoldDataset(invalid),
    /must explain why it should not resolve/u,
  );
});

test('a vague or mismatched follow-up fails the clarification UX gate', async () => {
  const gold = await readFixture('place-resolution-gold.v1.json');
  const predictions = await readFixture(
    'place-resolution-predictions.example.v1.json',
  );
  const vague = structuredClone(predictions);
  const prediction = vague.predictions.find(
    (entry) => entry.caseId === 'ambiguous-starbucks-shibuya',
  );
  prediction.clarification.requestedHint = 'area_or_station';

  const report = scorePlaceResolution(gold, vague);
  assert.equal(report.metrics.clarificationAccuracy, 1);
  assert.equal(report.metrics.clarificationUxAccuracy, 0.8889);
  assert.equal(report.passes, false);
  assert.equal(report.failures[0].caseId, 'ambiguous-starbucks-shibuya');
});

test('an empty candidate offer is rejected before it can score', async () => {
  const gold = await readFixture('place-resolution-gold.v1.json');
  const predictions = await readFixture(
    'place-resolution-predictions.example.v1.json',
  );
  const emptyOffer = structuredClone(predictions);
  const prediction = emptyOffer.predictions.find(
    (entry) => entry.caseId === 'ambiguous-afuri-roppongi',
  );
  prediction.clarification.candidates = [];

  assert.throws(
    () => scorePlaceResolution(gold, emptyOffer),
    /candidate offer must contain two or three options/u,
  );
});

test('invented candidate options fail clarification UX even when the count is valid', async () => {
  const gold = await readFixture('place-resolution-gold.v1.json');
  const predictions = await readFixture(
    'place-resolution-predictions.example.v1.json',
  );
  const invented = structuredClone(predictions);
  const prediction = invented.predictions.find(
    (entry) => entry.caseId === 'ambiguous-afuri-roppongi',
  );
  prediction.clarification.candidates = [
    { rank: 1, candidateId: 'invented-one', label: 'Invented branch one' },
    { rank: 2, candidateId: 'invented-two', label: 'Invented branch two' },
  ];

  const report = scorePlaceResolution(gold, invented);
  assert.equal(report.passes, false);
  assert.equal(report.metrics.clarificationUxAccuracy, 0.8889);
  assert.equal(report.failures[0].caseId, 'ambiguous-afuri-roppongi');
});

test('a verified candidate ID with a misleading label fails clarification UX', async () => {
  const gold = await readFixture('place-resolution-gold.v1.json');
  const predictions = await readFixture(
    'place-resolution-predictions.example.v1.json',
  );
  const misleading = structuredClone(predictions);
  const prediction = misleading.predictions.find(
    (entry) => entry.caseId === 'ambiguous-afuri-roppongi',
  );
  prediction.clarification.candidates[0].label =
    'AFURI Roppongi Hills — wrong branch label';

  const report = scorePlaceResolution(gold, misleading);
  assert.equal(report.passes, false);
  assert.equal(report.metrics.clarificationUxAccuracy, 0.8889);
  assert.equal(report.failures[0].caseId, 'ambiguous-afuri-roppongi');
});

test('top-three recall counts the third provider candidate independently of selection', async () => {
  const gold = await readFixture('place-resolution-gold.v1.json');
  const predictions = await readFixture(
    'place-resolution-predictions.example.v1.json',
  );
  const changed = structuredClone(predictions);
  const testCase = gold.cases.find(
    (entry) => entry.gold.expectedAction === 'resolve',
  );
  const prediction = changed.predictions.find(
    (entry) => entry.caseId === testCase.caseId,
  );
  prediction.selectedIdentityId = 'wrong-selection';
  prediction.candidateIdentityIds = [
    'candidate-one',
    'candidate-two',
    testCase.gold.identityId,
  ];

  const report = scorePlaceResolution(gold, changed);
  assert.equal(report.metrics.top3TargetRecall, 1);
});
