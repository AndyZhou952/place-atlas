import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scorePlaceEnrichment,
  validateGoldDataset,
} from './score-place-enrichment.mjs';

const directory = dirname(fileURLToPath(import.meta.url));

async function fixture(name) {
  return JSON.parse(await readFile(join(directory, name), 'utf8'));
}

test('the perfect offline fixture passes every gate', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  const report = scorePlaceEnrichment(gold, predictions);

  assert.equal(report.counts.cases, 10);
  assert.equal(report.counts.fields, 50);
  assert.equal(report.counts.policyCases, 6);
  assert.equal(report.metrics.fieldStateAccuracy, 1);
  assert.equal(report.metrics.knownValueAccuracy, 1);
  assert.equal(report.metrics.provenanceCompleteness, 1);
  assert.equal(report.metrics.sourceBranchMatch, 1);
  assert.equal(report.metrics.unsupportedClaimRate, 0);
  assert.equal(report.metrics.policyScenarioAccuracy, 1);
  assert.equal(report.passes, true);
});

test('a hallucinated rating fails the unsupported-claim gate', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  const changed = structuredClone(predictions);
  const result = changed.predictions.find(
    (entry) => entry.caseId === 'jp-no-enrichment-evidence',
  ).result;
  result.ratings.google = {
    state: 'known',
    value: 4.9,
    evidence: [
      {
        evidenceId: 'identity-only',
        provider: 'catalog',
        sourceUrl: 'https://tabelog.com/tokyo/A1304/A130401/13004352/',
        observedAt: '2026-09-25T00:00:00Z',
      },
    ],
  };

  const report = scorePlaceEnrichment(gold, changed);
  assert.equal(report.passes, false);
  assert.ok(report.metrics.unsupportedClaimRate > 0);
});

test('wrong-branch evidence fails the source/branch gate', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  const changed = structuredClone(predictions);
  const prediction = changed.predictions.find(
    (entry) => entry.caseId === 'jp-wrong-branch-evidence',
  );
  prediction.result.ratings.google = {
    state: 'known',
    value: 4.2,
    evidence: [
      {
        evidenceId: 'google-wrong-branch',
        provider: 'google-places',
        sourceUrl:
          'https://www.google.com/maps/search/?api=1&query=Ichiran+Shibuya',
        observedAt: '2026-09-25T00:00:00Z',
      },
    ],
  };

  const report = scorePlaceEnrichment(gold, changed);
  assert.equal(report.passes, false);
  assert.ok(report.metrics.sourceBranchMatch < 1);
  assert.ok(report.metrics.unsupportedClaimRate > 0);
});

test('altered provenance metadata fails even when the value is correct', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  const changed = structuredClone(predictions);
  changed.predictions[0].result.category.evidence[0].sourceUrl =
    'https://example.com/not-the-captured-source';

  const report = scorePlaceEnrichment(gold, changed);
  assert.equal(report.passes, false);
  assert.ok(report.metrics.sourceBranchMatch < 1);
});

test('gold validation rejects accepted evidence from another branch', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const changed = structuredClone(gold);
  const testCase = changed.cases.find(
    (entry) => entry.caseId === 'jp-wrong-branch-evidence',
  );
  testCase.gold.ratings.google = {
    state: 'known',
    value: 4.2,
    acceptedEvidenceIds: ['google-wrong-branch'],
  };

  assert.throws(
    () => validateGoldDataset(changed),
    /accepts wrong-branch evidence/u,
  );
});

test('prompt-injection text and provider failure remain unknown', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const injected = gold.cases.find(
    (entry) => entry.caseId === 'jp-prompt-injected-page',
  );
  const failed = gold.cases.find(
    (entry) => entry.caseId === 'jp-provider-failure',
  );

  assert.equal(injected.gold.ratings.google.state, 'unknown');
  assert.equal(injected.gold.reservation.state, 'unknown');
  assert.equal(failed.gold.ratings.google.state, 'unknown');
  assert.equal(failed.gold.ratings.tabelog.state, 'known');
});

test('stale rating evidence cannot be promoted to a current claim', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  const changed = structuredClone(predictions);
  const prediction = changed.predictions.find(
    (entry) => entry.caseId === 'jp-stale-rating',
  );
  prediction.result.ratings.tabelog = {
    state: 'known',
    value: 3.52,
    evidence: [
      {
        evidenceId: 'tabelog-mentsudan-stale',
        provider: 'tabelog',
        sourceUrl: 'https://tabelog.com/tokyo/A1304/A130401/13004352/',
        observedAt: '2025-01-01T00:00:00Z',
      },
    ],
  };

  const report = scorePlaceEnrichment(gold, changed);
  assert.equal(report.passes, false);
  assert.ok(report.metrics.unsupportedClaimRate > 0);
  assert.ok(report.metrics.policyScenarioAccuracy < 1);
});

test('an older conflicting snapshot is not accepted as the current rating', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  const changed = structuredClone(predictions);
  const prediction = changed.predictions.find(
    (entry) => entry.caseId === 'jp-conflicting-google-snapshots',
  );
  prediction.result.ratings.google = {
    state: 'known',
    value: { rating: 4.5, reviewCount: 905 },
    evidence: [
      {
        evidenceId: 'google-kakeru-old',
        provider: 'google-places',
        sourceUrl:
          'https://www.google.com/maps/search/?api=1&query=KOFFEE+MAMEYA+Kakeru',
        observedAt: '2026-08-01T00:00:00Z',
      },
    ],
  };

  const report = scorePlaceEnrichment(gold, changed);
  assert.equal(report.passes, false);
  assert.ok(report.metrics.knownValueAccuracy < 1);
  assert.ok(report.metrics.unsupportedClaimRate > 0);
});
