import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const POSITIVE = 'accessible_positive';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateEvidence(evidence, path) {
  assert(evidence && typeof evidence === 'object', `${path} is required`);
  assert(
    typeof evidence.provider === 'string' && evidence.provider,
    `${path}.provider is required`,
  );
  assert(
    typeof evidence.sourceUrl === 'string' &&
      evidence.sourceUrl.startsWith('https://'),
    `${path}.sourceUrl must be HTTPS`,
  );
  assert(
    /^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)$/u.test(
      evidence.observedAt,
    ),
    `${path}.observedAt is invalid`,
  );
}

export function validateRatingBenchmark(benchmark) {
  assert(benchmark?.schemaVersion === 1, 'benchmark schemaVersion must be 1');
  assert(
    Array.isArray(benchmark.cases) &&
      benchmark.cases.length >= 5 &&
      benchmark.cases.length <= 8,
    'benchmark must contain 5-8 cases',
  );
  const ids = new Set();
  for (const entry of benchmark.cases) {
    assert(
      typeof entry.caseId === 'string' && !ids.has(entry.caseId),
      `duplicate or missing caseId: ${entry.caseId}`,
    );
    ids.add(entry.caseId);
    assert(
      typeof entry.identityId === 'string' &&
        typeof entry.branchId === 'string' &&
        typeof entry.address === 'string',
      `${entry.caseId} identity/address is required`,
    );
    assert(
      entry.mode === 'live_verified' ||
        entry.mode === 'frozen_extraction' ||
        entry.mode === 'synthetic_negative',
      `${entry.caseId}.mode is invalid`,
    );
    validateEvidence(entry.evidence, `${entry.caseId}.evidence`);
    if (entry.scenario === POSITIVE) {
      assert(
        typeof entry.expected?.aggregateScore === 'number',
        `${entry.caseId} needs an independently verified aggregateScore`,
      );
      assert(
        entry.mode !== 'synthetic_negative',
        `${entry.caseId} positive cannot be synthetic`,
      );
    } else
      assert(
        entry.expected?.state === 'unknown',
        `${entry.caseId} safety cases must expect unknown`,
      );
  }
  assert(
    benchmark.cases.some((entry) => entry.scenario === POSITIVE),
    'benchmark needs an accessible positive',
  );
  return benchmark;
}

function validCitation(prediction, expected) {
  const citation = prediction.evidence;
  return (
    citation &&
    citation.provider === expected.provider &&
    citation.sourceUrl === expected.sourceUrl &&
    typeof citation.observedAt === 'string' &&
    /^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)$/u.test(
      citation.observedAt,
    ) &&
    Number.isFinite(Date.parse(citation.observedAt)) &&
    citation.observedAt.slice(0, 10) === expected.observedAt.slice(0, 10)
  );
}

export function scoreRatingCompletion(benchmark, predictions) {
  validateRatingBenchmark(benchmark);
  assert(
    predictions && Array.isArray(predictions.predictions),
    'predictions.predictions must be an array',
  );
  const byId = new Map();
  for (const prediction of predictions.predictions) {
    assert(
      !byId.has(prediction.caseId),
      `duplicate prediction: ${prediction.caseId}`,
    );
    assert(
      prediction.state === 'known' || prediction.state === 'unknown',
      `${prediction.caseId}.state must be known or unknown`,
    );
    if (prediction.state === 'unknown')
      assert(
        prediction.aggregateScore === undefined,
        `${prediction.caseId} unknown prediction cannot include aggregateScore`,
      );
    if (prediction.state === 'known')
      assert(
        typeof prediction.aggregateScore === 'number',
        `${prediction.caseId} known prediction needs aggregateScore`,
      );
    byId.set(prediction.caseId, prediction);
  }
  const expectedIds = new Set(benchmark.cases.map((entry) => entry.caseId));
  assert(
    byId.size === expectedIds.size &&
      [...expectedIds].every((id) => byId.has(id)),
    'predictions must include every case exactly once',
  );
  const positives = benchmark.cases.filter(
    (entry) => entry.scenario === POSITIVE,
  );
  let completed = 0;
  let exact = 0;
  let known = 0;
  let provenance = 0;
  let safe = 0;
  const failures = [];
  for (const entry of benchmark.cases) {
    const prediction = byId.get(entry.caseId);
    const isKnown =
      prediction?.state === 'known' && prediction.aggregateScore !== undefined;
    if (isKnown) known += 1;
    const citationOk = isKnown && validCitation(prediction, entry.evidence);
    if (isKnown && citationOk) provenance += 1;
    if (entry.scenario === POSITIVE) {
      const branchOk =
        prediction?.identityId === entry.identityId &&
        prediction?.branchId === entry.branchId;
      const scoreOk =
        isKnown && prediction.aggregateScore === entry.expected.aggregateScore;
      if (branchOk && scoreOk) exact += 1;
      if (branchOk && scoreOk && citationOk) completed += 1;
      else
        failures.push({
          caseId: entry.caseId,
          reason: 'positive_not_completed_exactly',
        });
    } else if (prediction?.state === 'unknown') safe += 1;
    else
      failures.push({
        caseId: entry.caseId,
        reason: 'unsafe_claim_on_control',
      });
  }
  const safetyCases = benchmark.cases.length - positives.length;
  const metrics = {
    completionCoverage: completed / positives.length,
    exactClaimAccuracy: known ? exact / known : 0,
    provenanceCompleteness: known ? provenance / known : 0,
    safeFailureRate: safetyCases ? safe / safetyCases : 1,
  };
  return {
    benchmarkId: benchmark.benchmarkId,
    counts: {
      cases: benchmark.cases.length,
      accessiblePositives: positives.length,
      completedPositives: completed,
      knownClaims: known,
      safetyCases,
    },
    metrics,
    passes:
      metrics.completionCoverage === 1 &&
      metrics.exactClaimAccuracy === 1 &&
      metrics.provenanceCompleteness === 1 &&
      metrics.safeFailureRate === 1,
    failures,
  };
}

async function main() {
  const [, , benchmarkPath, predictionsPath] = process.argv;
  if (!benchmarkPath || !predictionsPath) {
    console.error(
      'Usage: node score-rating-completion.mjs <benchmark.json> <predictions.json>',
    );
    process.exitCode = 2;
    return;
  }
  try {
    const [benchmark, predictions] = await Promise.all([
      readFile(benchmarkPath, 'utf8').then(JSON.parse),
      readFile(predictionsPath, 'utf8').then(JSON.parse),
    ]);
    const report = scoreRatingCompletion(benchmark, predictions);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passes ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
