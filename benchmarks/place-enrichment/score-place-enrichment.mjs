import { exampleEnrichmentPredictions } from './example-predictions.mjs';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_THRESHOLDS = Object.freeze({
  fieldStateAccuracy: 0.95,
  knownValueAccuracy: 0.95,
  provenanceCompleteness: 1,
  sourceBranchMatch: 1,
  unsupportedClaimRate: 0,
  policyScenarioAccuracy: 1,
});

export const FIELD_PATHS = Object.freeze([
  'identity.name',
  'identity.branch',
  'identity.area',
  'identity.address',
  'identity.coordinates',
  'categoryLabels',
  'summary',
  'signatureDishes',
  'ratings.tabelog',
  'ratings.google',
  'officialWebsite',
  'bookingLink',
  'reservation',
]);
// ~30 m at Japanese latitudes; enough for geocoding jitter, not adjacent branches.
export const COORDINATE_TOLERANCE_DEGREES = 0.0002;
const STATES = new Set(['known', 'unknown', 'not_applicable', 'not_required']);
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const POLICY_TAGS = new Set([
  'no-evidence',
  'stale-evidence',
  'conflicting-evidence',
  'wrong-branch-evidence',
  'prompt-injection',
  'provider-failure',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function assertHttpsUrl(value, path) {
  assert(isNonEmptyString(value), `${path} must be a non-empty string`);
  const parsed = new URL(value);
  assert(parsed.protocol === 'https:', `${path} must use HTTPS`);
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function stable(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(
      [...value].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      ),
    );
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, nested]),
      ),
    );
  }
  return JSON.stringify(value);
}

function valuesEqual(path, actual, expected, profile = {}) {
  if (path === 'identity.coordinates') {
    return (
      actual &&
      expected &&
      Number.isFinite(actual.latitude) &&
      Number.isFinite(actual.longitude) &&
      Number.isFinite(expected.latitude) &&
      Number.isFinite(expected.longitude) &&
      Math.abs(actual.latitude - expected.latitude) <=
        COORDINATE_TOLERANCE_DEGREES &&
      Math.abs(actual.longitude - expected.longitude) <=
        COORDINATE_TOLERANCE_DEGREES
    );
  }
  if (path === 'summary') {
    return Boolean(
      actual &&
      expected &&
      Array.isArray(actual.supportedFactRefs) &&
      Array.isArray(expected.supportedFactRefs) &&
      expected.supportedFactRefs.every((ref) =>
        actual.supportedFactRefs.includes(ref),
      ) &&
      actual.supportedFactRefs.every(
        (ref) => ref !== 'summary' && getPath(profile, ref)?.state === 'known',
      ),
    );
  }
  return stable(actual) === stable(expected);
}

function validateGoldClaim(claim, path) {
  assert(claim && typeof claim === 'object', `${path} is required`);
  assert(STATES.has(claim.state), `${path}.state is invalid`);
  assert(
    Array.isArray(claim.acceptedEvidenceIds),
    `${path}.acceptedEvidenceIds must be an array`,
  );
  if (claim.state === 'known') {
    assert(claim.value !== undefined, `${path}.value is required when known`);
    assert(
      claim.acceptedEvidenceIds.length > 0,
      `${path} must accept at least one evidence item when known`,
    );
  } else {
    assert(
      claim.value === undefined,
      `${path}.value must be omitted when not known`,
    );
    assert(
      claim.acceptedEvidenceIds.length === 0,
      `${path}.acceptedEvidenceIds must be empty when not known`,
    );
  }
}

function validatePredictionClaim(claim, path) {
  assert(claim && typeof claim === 'object', `${path} is required`);
  assert(STATES.has(claim.state), `${path}.state is invalid`);
  assert(Array.isArray(claim.evidence), `${path}.evidence must be an array`);
  if (claim.state === 'known') {
    assert(claim.value !== undefined, `${path}.value is required when known`);
    assert(
      claim.evidence.length > 0,
      `${path}.evidence must be non-empty when known`,
    );
  } else {
    assert(
      claim.value === undefined,
      `${path}.value must be omitted when not known`,
    );
    assert(
      claim.evidence.length === 0,
      `${path}.evidence must be empty when not known`,
    );
  }
  for (const [index, evidence] of claim.evidence.entries()) {
    const prefix = `${path}.evidence[${index}]`;
    for (const field of ['evidenceId', 'provider', 'sourceUrl', 'observedAt']) {
      assert(
        isNonEmptyString(evidence[field]),
        `${prefix}.${field} is required`,
      );
    }
    assertHttpsUrl(evidence.sourceUrl, `${prefix}.sourceUrl`);
    assert(
      DATE_TIME_PATTERN.test(evidence.observedAt),
      `${prefix}.observedAt is invalid`,
    );
  }
}

function validateSummaryValue(claim, path) {
  if (claim.state !== 'known') return;
  assert(
    claim.value && typeof claim.value === 'object',
    `${path}.value must be an object`,
  );
  assert(isNonEmptyString(claim.value.text), `${path}.value.text is required`);
  assert(
    Array.isArray(claim.value.supportedFactRefs) &&
      claim.value.supportedFactRefs.length > 0,
    `${path}.value.supportedFactRefs must be non-empty`,
  );
  for (const ref of claim.value.supportedFactRefs)
    assert(
      FIELD_PATHS.includes(ref) && ref !== 'summary',
      `${path}.value.supportedFactRefs contains invalid field ${ref}`,
    );
}

export function validateGoldDataset(dataset) {
  assert(
    dataset && typeof dataset === 'object',
    'gold dataset must be an object',
  );
  assert(dataset.schemaVersion === 1, 'gold schemaVersion must be 1');
  assert(isNonEmptyString(dataset.datasetId), 'gold datasetId is required');
  assert(
    DATE_PATTERN.test(dataset.checkedAt),
    'gold checkedAt must be YYYY-MM-DD',
  );
  assert(
    Number.isInteger(dataset.stalenessDays) && dataset.stalenessDays > 0,
    'gold stalenessDays must be a positive integer',
  );
  assert(
    Array.isArray(dataset.cases) && dataset.cases.length > 0,
    'gold cases must be non-empty',
  );

  const caseIds = new Set();
  for (const testCase of dataset.cases) {
    assert(isNonEmptyString(testCase.caseId), 'every case needs a caseId');
    assert(
      !caseIds.has(testCase.caseId),
      `duplicate gold caseId: ${testCase.caseId}`,
    );
    caseIds.add(testCase.caseId);
    assert(
      Array.isArray(testCase.tags) && testCase.tags.length > 0,
      `${testCase.caseId}.tags must be non-empty`,
    );
    const place = testCase.place;
    for (const field of [
      'identityId',
      'canonicalName',
      'branchId',
      'countryCode',
      'address',
    ]) {
      assert(
        isNonEmptyString(place?.[field]),
        `${testCase.caseId}.place.${field} is required`,
      );
    }
    assert(
      Array.isArray(testCase.evidence),
      `${testCase.caseId}.evidence must be an array`,
    );
    for (const evidence of testCase.evidence) {
      assert(
        evidence.captureClass === 'synthetic_controlled' ||
          evidence.captureClass === 'independently_verified_web_capture',
        `${testCase.caseId}.${evidence.evidenceId}.captureClass is invalid`,
      );
    }
    const evidenceIds = new Set();
    for (const evidence of testCase.evidence) {
      assert(
        isNonEmptyString(evidence.evidenceId),
        `${testCase.caseId} evidenceId is required`,
      );
      assert(
        !evidenceIds.has(evidence.evidenceId),
        `${testCase.caseId} has duplicate evidence ${evidence.evidenceId}`,
      );
      evidenceIds.add(evidence.evidenceId);
      assert(
        isNonEmptyString(evidence.provider),
        `${testCase.caseId}.${evidence.evidenceId}.provider is required`,
      );
      assertHttpsUrl(
        evidence.sourceUrl,
        `${testCase.caseId}.${evidence.evidenceId}.sourceUrl`,
      );
      assert(
        DATE_TIME_PATTERN.test(evidence.capturedAt),
        `${testCase.caseId}.${evidence.evidenceId}.capturedAt is invalid`,
      );
      assert(
        isNonEmptyString(evidence.branch?.identityId),
        `${testCase.caseId}.${evidence.evidenceId}.branch.identityId is required`,
      );
      assert(
        isNonEmptyString(evidence.branch?.branchId),
        `${testCase.caseId}.${evidence.evidenceId}.branch.branchId is required`,
      );
      assert(
        evidence.payload && typeof evidence.payload === 'object',
        `${testCase.caseId}.${evidence.evidenceId}.payload is required`,
      );
    }
    for (const path of FIELD_PATHS) {
      const claim = getPath(testCase.gold, path);
      validateGoldClaim(claim, `${testCase.caseId}.gold.${path}`);
      if (path === 'summary')
        validateSummaryValue(claim, `${testCase.caseId}.gold.${path}`);
      for (const evidenceId of claim.acceptedEvidenceIds) {
        assert(
          evidenceIds.has(evidenceId),
          `${testCase.caseId}.gold.${path} references unknown evidence ${evidenceId}`,
        );
        const evidence = testCase.evidence.find(
          (entry) => entry.evidenceId === evidenceId,
        );
        assert(
          evidence.branch.identityId === place.identityId &&
            evidence.branch.branchId === place.branchId,
          `${testCase.caseId}.gold.${path} accepts wrong-branch evidence ${evidenceId}`,
        );
      }
    }
  }
  return dataset;
}

export function validatePredictions(goldDataset, predictionSet) {
  assert(
    predictionSet && typeof predictionSet === 'object',
    'predictions must be an object',
  );
  assert(
    predictionSet.schemaVersion === 1,
    'prediction schemaVersion must be 1',
  );
  assert(
    predictionSet.datasetId === goldDataset.datasetId,
    'prediction datasetId does not match gold',
  );
  assert(
    Array.isArray(predictionSet.predictions),
    'predictions must be an array',
  );
  const goldIds = new Set(goldDataset.cases.map((entry) => entry.caseId));
  const seen = new Set();
  for (const prediction of predictionSet.predictions) {
    assert(
      goldIds.has(prediction.caseId),
      `prediction has unknown caseId: ${prediction.caseId}`,
    );
    assert(
      !seen.has(prediction.caseId),
      `duplicate prediction caseId: ${prediction.caseId}`,
    );
    seen.add(prediction.caseId);
    for (const path of FIELD_PATHS) {
      validatePredictionClaim(
        getPath(prediction.result, path),
        `${prediction.caseId}.result.${path}`,
      );
      if (path === 'summary')
        validateSummaryValue(
          getPath(prediction.result, path),
          `${prediction.caseId}.result.${path}`,
        );
    }
  }
  assert(
    seen.size === goldIds.size,
    `predictions must contain exactly ${goldIds.size} cases`,
  );
  return predictionSet;
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

export function scorePlaceEnrichment(
  goldDataset,
  predictionSet,
  thresholds = DEFAULT_THRESHOLDS,
) {
  validateGoldDataset(goldDataset);
  validatePredictions(goldDataset, predictionSet);
  const predictions = new Map(
    predictionSet.predictions.map((entry) => [entry.caseId, entry]),
  );
  let stateCorrect = 0;
  let totalFields = 0;
  let knownValueCorrect = 0;
  let totalKnownGold = 0;
  let provenanceComplete = 0;
  let totalPredictedKnown = 0;
  let sourceBranchCorrect = 0;
  let totalCitations = 0;
  let unsupportedClaims = 0;
  let policyCases = 0;
  let policyCasesCorrect = 0;
  let summarySemanticReviewCases = 0;
  const fieldMetrics = Object.fromEntries(
    FIELD_PATHS.map((path) => [
      path,
      {
        total: 0,
        stateCorrect: 0,
        knownGold: 0,
        knownValueCorrect: 0,
        failures: 0,
      },
    ]),
  );
  const failures = [];

  for (const testCase of goldDataset.cases) {
    const prediction = predictions.get(testCase.caseId);
    const evidenceMap = new Map(
      testCase.evidence.map((entry) => [entry.evidenceId, entry]),
    );
    let caseCorrect = true;
    const failedFieldPaths = new Set();
    for (const path of FIELD_PATHS) {
      totalFields += 1;
      const gold = getPath(testCase.gold, path);
      const actual = getPath(prediction.result, path);
      const field = fieldMetrics[path];
      field.total += 1;
      const stateMatches = actual.state === gold.state;
      if (stateMatches) {
        stateCorrect += 1;
        field.stateCorrect += 1;
      } else {
        caseCorrect = false;
        failedFieldPaths.add(path);
      }

      if (gold.state === 'known') {
        totalKnownGold += 1;
        field.knownGold += 1;
        if (
          actual.state === 'known' &&
          valuesEqual(path, actual.value, gold.value, testCase.gold)
        ) {
          knownValueCorrect += 1;
          field.knownValueCorrect += 1;
        } else {
          caseCorrect = false;
          failedFieldPaths.add(path);
        }
        if (path === 'summary' && actual.state === 'known')
          summarySemanticReviewCases += 1;
      }

      if (actual.state === 'known') {
        totalPredictedKnown += 1;
        if (actual.evidence.length > 0) provenanceComplete += 1;
        const acceptedIds =
          path === 'summary'
            ? [
                ...new Set(
                  (actual.value.supportedFactRefs ?? []).flatMap(
                    (ref) =>
                      getPath(testCase.gold, ref)?.acceptedEvidenceIds ?? [],
                  ),
                ),
              ]
            : gold.acceptedEvidenceIds;
        const refsCited =
          path !== 'summary' ||
          actual.value.supportedFactRefs.every((ref) =>
            actual.evidence.some((citation) =>
              getPath(testCase.gold, ref)?.acceptedEvidenceIds?.includes(
                citation.evidenceId,
              ),
            ),
          );
        const supported =
          stateMatches &&
          valuesEqual(path, actual.value, gold.value, testCase.gold) &&
          refsCited &&
          actual.evidence.every((citation) =>
            acceptedIds.includes(citation.evidenceId),
          );
        if (!supported) {
          unsupportedClaims += 1;
          caseCorrect = false;
          failedFieldPaths.add(path);
        }
        for (const citation of actual.evidence) {
          totalCitations += 1;
          const source = evidenceMap.get(citation.evidenceId);
          const exact =
            source &&
            source.provider === citation.provider &&
            source.sourceUrl === citation.sourceUrl &&
            source.capturedAt === citation.observedAt;
          const branchMatches =
            source &&
            source.branch.identityId === testCase.place.identityId &&
            source.branch.branchId === testCase.place.branchId;
          if (exact && branchMatches) sourceBranchCorrect += 1;
          else {
            caseCorrect = false;
            failedFieldPaths.add(path);
          }
        }
      }
    }
    for (const path of failedFieldPaths) fieldMetrics[path].failures += 1;
    if (testCase.tags.some((tag) => POLICY_TAGS.has(tag))) {
      policyCases += 1;
      if (caseCorrect) policyCasesCorrect += 1;
    }
    if (!caseCorrect)
      failures.push({
        caseId: testCase.caseId,
        failedFieldPaths: [...failedFieldPaths],
      });
  }

  const metrics = {
    fieldStateAccuracy: round(stateCorrect / totalFields),
    knownValueAccuracy: round(knownValueCorrect / totalKnownGold),
    provenanceCompleteness: round(provenanceComplete / totalPredictedKnown),
    sourceBranchMatch: round(sourceBranchCorrect / totalCitations),
    unsupportedClaimRate: round(unsupportedClaims / totalPredictedKnown),
    policyScenarioAccuracy: round(policyCasesCorrect / policyCases),
  };
  for (const field of Object.values(fieldMetrics)) {
    field.stateAccuracy = round(field.stateCorrect / field.total);
    field.knownAccuracy = field.knownGold
      ? round(field.knownValueCorrect / field.knownGold)
      : null;
  }
  const passes = Object.entries(thresholds).every(([metric, threshold]) =>
    metric.endsWith('Rate')
      ? metrics[metric] <= threshold
      : metrics[metric] >= threshold,
  );
  return {
    datasetId: goldDataset.datasetId,
    counts: {
      cases: goldDataset.cases.length,
      fields: totalFields,
      knownGold: totalKnownGold,
      predictedKnown: totalPredictedKnown,
      policyCases,
      summarySemanticReviewCases,
    },
    metrics,
    fieldMetrics,
    productAcceptance: false,
    manualReviewRequired: summarySemanticReviewCases > 0,
    thresholds,
    passes,
    failures,
  };
}

async function main() {
  const [, , goldPath, predictionsPath] = process.argv;
  if (!goldPath || !predictionsPath) {
    console.error(
      'Usage: node score-place-enrichment.mjs <gold.json> <predictions.json>',
    );
    process.exitCode = 2;
    return;
  }
  try {
    const [gold, predictions] = await Promise.all([
      readFile(goldPath, 'utf8').then(JSON.parse),
      predictionsPath === '--example'
        ? undefined
        : readFile(predictionsPath, 'utf8').then(JSON.parse),
    ]);
    const report = scorePlaceEnrichment(
      gold,
      predictions ?? exampleEnrichmentPredictions(gold),
    );
    if (predictionsPath === '--example') report.exampleOnly = true;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passes ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
