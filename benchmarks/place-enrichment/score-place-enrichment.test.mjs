import { exampleEnrichmentPredictions } from './example-predictions.mjs';
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

test('known website links have explicit payload support and live captures exclude synthetic dishes', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  for (const entry of gold.cases) {
    for (const field of ['officialWebsite', 'bookingLink']) {
      const claim = entry.gold[field];
      if (claim.state !== 'known') continue;
      assert.ok(
        entry.evidence.some(
          (source) =>
            claim.acceptedEvidenceIds.includes(source.evidenceId) &&
            JSON.stringify(source.payload).includes(claim.value),
        ),
        `${entry.caseId}: ${field}`,
      );
    }
  }
  const live = gold.cases[0].evidence.find(
    (source) => source.captureClass === 'independently_verified_web_capture',
  );
  assert.equal(live.payload.signatureDishes, undefined);
  assert.equal(live.payload.reservationNotListed, undefined);
  assert.equal(
    gold.cases[0].evidence.some(
      (source) => source.evidenceId === 'controlled-identity',
    ),
    false,
  );
});

async function fixture(name) {
  if (name === 'place-enrichment-predictions.example.v1.json') {
    return exampleEnrichmentPredictions(
      await fixture('place-enrichment-gold.v1.json'),
    );
  }
  return JSON.parse(await readFile(join(directory, name), 'utf8'));
}

test('coordinate tolerance rejects location drift and reports the specific field', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  predictions.predictions[0].result.identity.coordinates.value.latitude += 0.0001;
  assert.equal(scorePlaceEnrichment(gold, predictions).passes, true);
  predictions.predictions[0].result.identity.coordinates.value.latitude += 0.001;
  const report = scorePlaceEnrichment(gold, predictions);
  assert.equal(report.passes, false);
  assert.ok(
    report.failures[0].failedFieldPaths.includes('identity.coordinates'),
  );
});

test('summary wording is not exact matched but needs manual semantic review', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  predictions.predictions[0].result.summary.value.text =
    'A dining spot serving croquettes and Western-style dishes, with seasonal oysters in the supplied fixture.';
  const report = scorePlaceEnrichment(gold, predictions);
  assert.equal(report.passes, true);
  assert.equal(report.manualReviewRequired, true);
  assert.equal(report.productAcceptance, false);
  predictions.predictions[0].result.summary.value.supportedFactRefs.push(
    'identity.name',
  );
  predictions.predictions[0].result.summary.evidence.push(
    ...predictions.predictions[0].result.identity.name.evidence,
  );
  assert.equal(scorePlaceEnrichment(gold, predictions).passes, true);
  predictions.predictions[0].result.summary.value.supportedFactRefs.push(
    'reservation',
  );
  assert.equal(scorePlaceEnrichment(gold, predictions).passes, false);
});

test('invented reservation difficulty and incorrect citations fail with field diagnostics', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  predictions.predictions[0].result.ratings.tabelog.evidence[0].observedAt =
    '2020-01-01T00:00:00Z';
  const first = scorePlaceEnrichment(gold, predictions);
  assert.equal(first.passes, false);
  assert.ok(first.failures[0].failedFieldPaths.includes('ratings.tabelog'));
  assert.equal(first.fieldMetrics['ratings.tabelog'].failures, 1);
  predictions.predictions[1].result.reservation.value.difficulty = 'easy';
  const second = scorePlaceEnrichment(gold, predictions);
  assert.ok(
    second.failures
      .find((f) => f.caseId === predictions.predictions[1].caseId)
      .failedFieldPaths.includes('reservation'),
  );
});

test('the perfect offline fixture passes every gate', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  const report = scorePlaceEnrichment(gold, predictions);

  assert.equal(report.counts.cases, 10);
  assert.equal(report.counts.fields, 130);
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

test('returning unknown everywhere cannot pass completion quality even without invented scores', async () => {
  const gold = await fixture('place-enrichment-gold.v1.json');
  const predictions = await fixture(
    'place-enrichment-predictions.example.v1.json',
  );
  for (const prediction of predictions.predictions) {
    prediction.result.ratings.tabelog = { state: 'unknown', evidence: [] };
    prediction.result.ratings.google = { state: 'unknown', evidence: [] };
  }
  const report = scorePlaceEnrichment(gold, predictions);
  assert.equal(report.passes, false);
  assert.ok(report.metrics.knownValueAccuracy < 1);
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
  changed.predictions[0].result.categoryLabels.evidence[0].sourceUrl =
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
