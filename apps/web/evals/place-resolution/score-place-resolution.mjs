import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const DEFAULT_THRESHOLDS = Object.freeze({
  overallAccuracy: 0.9,
  actionAccuracy: 0.9,
  resolvedIdentityAccuracy: 0.9,
  top3TargetRecall: 0.95,
  clarificationAccuracy: 0.95,
  clarificationUxAccuracy: 0.95,
  noMatchAccuracy: 0.95,
  unsafeAutoResolveRate: 0,
});

const ACTIONS = new Set(['resolve', 'clarify', 'no_match']);
const CLARIFICATION_MODES = new Set([
  'ask_location',
  'ask_branch',
  'ask_identity',
  'offer_candidates',
]);
const CLARIFICATION_HINTS = new Set([
  'area_or_station',
  'branch_or_landmark',
  'restaurant_identity',
]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

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
    dataset.entities && typeof dataset.entities === 'object',
    'gold entities are required',
  );
  assert(
    Array.isArray(dataset.cases) && dataset.cases.length > 0,
    'gold cases must be non-empty',
  );

  for (const [identityId, entity] of Object.entries(dataset.entities)) {
    assert(isNonEmptyString(identityId), 'entity identityId must be non-empty');
    for (const field of [
      'canonicalName',
      'branchId',
      'branchName',
      'countryCode',
      'locality',
      'address',
    ]) {
      assert(
        isNonEmptyString(entity[field]),
        `entity ${identityId}.${field} is required`,
      );
    }
    assertHttpsUrl(entity.sourceUrl, `entity ${identityId}.sourceUrl`);
    assert(
      DATE_PATTERN.test(entity.checkedAt),
      `entity ${identityId}.checkedAt must be YYYY-MM-DD`,
    );
  }

  const caseIds = new Set();
  for (const testCase of dataset.cases) {
    assert(isNonEmptyString(testCase.caseId), 'every case needs a caseId');
    assert(
      !caseIds.has(testCase.caseId),
      `duplicate gold caseId: ${testCase.caseId}`,
    );
    caseIds.add(testCase.caseId);
    assert(
      isNonEmptyString(testCase.query),
      `${testCase.caseId}.query is required`,
    );
    assert(
      Array.isArray(testCase.tags) && testCase.tags.length > 0,
      `${testCase.caseId}.tags must be non-empty`,
    );
    assert(
      testCase.gold && typeof testCase.gold === 'object',
      `${testCase.caseId}.gold is required`,
    );
    const gold = testCase.gold;
    assert(
      ACTIONS.has(gold.expectedAction),
      `${testCase.caseId}.gold.expectedAction is invalid`,
    );
    assert(
      Array.isArray(gold.sourceUrls) && gold.sourceUrls.length > 0,
      `${testCase.caseId}.gold.sourceUrls must be non-empty`,
    );
    gold.sourceUrls.forEach((url, index) =>
      assertHttpsUrl(url, `${testCase.caseId}.gold.sourceUrls[${index}]`),
    );
    assert(
      DATE_PATTERN.test(gold.checkedAt),
      `${testCase.caseId}.gold.checkedAt must be YYYY-MM-DD`,
    );

    if (gold.expectedAction === 'resolve') {
      assert(
        isNonEmptyString(gold.identityId),
        `${testCase.caseId} must name a gold identityId`,
      );
      assert(
        isNonEmptyString(gold.branchId),
        `${testCase.caseId} must name a gold branchId`,
      );
      assert(
        dataset.entities[gold.identityId],
        `${testCase.caseId} references unknown entity ${gold.identityId}`,
      );
      assert(
        dataset.entities[gold.identityId].branchId === gold.branchId,
        `${testCase.caseId} branchId does not match entity ${gold.identityId}`,
      );
      if (testCase.tags.includes('short-message')) {
        assert(
          isNonEmptyString(gold.curationNote),
          `${testCase.caseId} short resolve case requires a curationNote`,
        );
      }
    } else {
      assert(
        gold.identityId === null,
        `${testCase.caseId} must use null identityId when not resolving`,
      );
      assert(
        gold.branchId === null,
        `${testCase.caseId} must use null branchId when not resolving`,
      );
      assert(
        isNonEmptyString(gold.clarificationReason),
        `${testCase.caseId} must explain why it should not resolve`,
      );
      if (gold.expectedAction === 'clarify') {
        const policy = gold.clarificationPolicy;
        assert(
          policy && typeof policy === 'object',
          `${testCase.caseId} must define clarificationPolicy`,
        );
        assert(
          Array.isArray(policy.acceptedModes) &&
            policy.acceptedModes.length > 0 &&
            policy.acceptedModes.every((mode) => CLARIFICATION_MODES.has(mode)),
          `${testCase.caseId}.clarificationPolicy.acceptedModes is invalid`,
        );
        assert(
          CLARIFICATION_HINTS.has(policy.requiredHint),
          `${testCase.caseId}.clarificationPolicy.requiredHint is invalid`,
        );
        if (policy.acceptedModes.includes('offer_candidates')) {
          const allowedCandidates = policy.allowedCandidates;
          assert(
            Array.isArray(allowedCandidates) && allowedCandidates.length >= 2,
            `${testCase.caseId}.clarificationPolicy.allowedCandidates is required for candidate offers`,
          );
          assert(
            allowedCandidates.every(
              (candidate) =>
                candidate &&
                typeof candidate === 'object' &&
                isNonEmptyString(candidate.candidateId) &&
                isNonEmptyString(candidate.label),
            ) &&
              new Set(
                allowedCandidates.map((candidate) => candidate.candidateId),
              ).size === allowedCandidates.length,
            `${testCase.caseId}.clarificationPolicy.allowedCandidates is invalid`,
          );
        } else {
          assert(
            policy.allowedCandidates === undefined,
            `${testCase.caseId}.clarificationPolicy.allowedCandidates requires offer_candidates`,
          );
        }
      } else {
        assert(
          gold.clarificationPolicy === undefined,
          `${testCase.caseId} must omit clarificationPolicy when action is not clarify`,
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

  const goldCaseIds = new Set(
    goldDataset.cases.map((testCase) => testCase.caseId),
  );
  const predictionCaseIds = new Set();
  for (const prediction of predictionSet.predictions) {
    assert(
      isNonEmptyString(prediction.caseId),
      'every prediction needs a caseId',
    );
    assert(
      goldCaseIds.has(prediction.caseId),
      `prediction has unknown caseId: ${prediction.caseId}`,
    );
    assert(
      !predictionCaseIds.has(prediction.caseId),
      `duplicate prediction caseId: ${prediction.caseId}`,
    );
    predictionCaseIds.add(prediction.caseId);
    assert(
      ACTIONS.has(prediction.action),
      `${prediction.caseId}.action is invalid`,
    );
    assert(
      Array.isArray(prediction.candidateIdentityIds),
      `${prediction.caseId}.candidateIdentityIds must be an array`,
    );
    assert(
      prediction.candidateIdentityIds.length <= 10,
      `${prediction.caseId}.candidateIdentityIds exceeds 10`,
    );
    assert(
      new Set(prediction.candidateIdentityIds).size ===
        prediction.candidateIdentityIds.length,
      `${prediction.caseId}.candidateIdentityIds must be unique`,
    );
    if (prediction.action === 'resolve') {
      assert(
        isNonEmptyString(prediction.selectedIdentityId),
        `${prediction.caseId} resolve action requires selectedIdentityId`,
      );
    } else {
      assert(
        prediction.selectedIdentityId === undefined,
        `${prediction.caseId} must omit selectedIdentityId when not resolving`,
      );
    }
    if (prediction.action === 'clarify') {
      const clarification = prediction.clarification;
      assert(
        clarification && typeof clarification === 'object',
        `${prediction.caseId} clarify action requires clarification`,
      );
      assert(
        CLARIFICATION_MODES.has(clarification.mode),
        `${prediction.caseId}.clarification.mode is invalid`,
      );
      assert(
        Array.isArray(clarification.candidates),
        `${prediction.caseId}.clarification.candidates must be an array`,
      );
      if (clarification.mode === 'offer_candidates') {
        assert(
          clarification.question === null &&
            clarification.requestedHint === null,
          `${prediction.caseId} candidate offer must use null question and requestedHint`,
        );
        assert(
          clarification.candidates.length >= 2 &&
            clarification.candidates.length <= 3,
          `${prediction.caseId} candidate offer must contain two or three options`,
        );
        const candidateIds = new Set();
        clarification.candidates.forEach((candidate, index) => {
          assert(
            candidate?.rank === index + 1,
            `${prediction.caseId} candidate ranks must be sequential from one`,
          );
          assert(
            isNonEmptyString(candidate.candidateId) &&
              isNonEmptyString(candidate.label),
            `${prediction.caseId} candidates need candidateId and label`,
          );
          assert(
            !candidateIds.has(candidate.candidateId),
            `${prediction.caseId} candidateId values must be unique`,
          );
          candidateIds.add(candidate.candidateId);
        });
      } else {
        assert(
          isNonEmptyString(clarification.question),
          `${prediction.caseId} follow-up mode requires a focused question`,
        );
        assert(
          CLARIFICATION_HINTS.has(clarification.requestedHint),
          `${prediction.caseId} follow-up mode requires a requestedHint`,
        );
        assert(
          clarification.candidates.length === 0,
          `${prediction.caseId} follow-up mode must not include candidate options`,
        );
      }
    } else {
      assert(
        prediction.clarification === undefined,
        `${prediction.caseId} must omit clarification when action is not clarify`,
      );
    }
  }

  for (const caseId of goldCaseIds) {
    assert(
      predictionCaseIds.has(caseId),
      `prediction is missing caseId: ${caseId}`,
    );
  }
  return predictionSet;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function round(value) {
  return value === null ? null : Number(value.toFixed(4));
}

function isCaseCorrect(testCase, prediction) {
  if (prediction.action !== testCase.gold.expectedAction) return false;
  if (prediction.action === 'clarify')
    return isClarificationUxCorrect(testCase, prediction);
  if (prediction.action !== 'resolve') return true;
  return prediction.selectedIdentityId === testCase.gold.identityId;
}

function isClarificationUxCorrect(testCase, prediction) {
  if (
    testCase.gold.expectedAction !== 'clarify' ||
    prediction.action !== 'clarify'
  )
    return false;
  const policy = testCase.gold.clarificationPolicy;
  const clarification = prediction.clarification;
  if (!policy.acceptedModes.includes(clarification.mode)) return false;
  if (clarification.mode === 'offer_candidates') {
    const allowedCandidates = new Map(
      (policy.allowedCandidates ?? []).map((candidate) => [
        candidate.candidateId,
        candidate.label,
      ]),
    );
    return (
      clarification.candidates.length >= 2 &&
      clarification.candidates.length <= 3 &&
      clarification.candidates.every(
        (candidate) =>
          allowedCandidates.get(candidate.candidateId) === candidate.label,
      )
    );
  }
  return clarification.requestedHint === policy.requiredHint;
}

function scoreTagSlices(cases, predictionsByCase) {
  const buckets = new Map();
  for (const testCase of cases) {
    for (const tag of testCase.tags) {
      const bucket = buckets.get(tag) ?? { correct: 0, count: 0 };
      bucket.count += 1;
      if (isCaseCorrect(testCase, predictionsByCase.get(testCase.caseId)))
        bucket.correct += 1;
      buckets.set(tag, bucket);
    }
  }
  return Object.fromEntries(
    [...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tag, bucket]) => [
        tag,
        {
          count: bucket.count,
          accuracy: round(ratio(bucket.correct, bucket.count)),
        },
      ]),
  );
}

export function scorePlaceResolution(
  goldInput,
  predictionsInput,
  thresholds = DEFAULT_THRESHOLDS,
) {
  const gold = validateGoldDataset(goldInput);
  const predictions = validatePredictions(gold, predictionsInput);
  const predictionsByCase = new Map(
    predictions.predictions.map((prediction) => [
      prediction.caseId,
      prediction,
    ]),
  );
  const resolveCases = gold.cases.filter(
    (testCase) => testCase.gold.expectedAction === 'resolve',
  );
  const clarifyCases = gold.cases.filter(
    (testCase) => testCase.gold.expectedAction === 'clarify',
  );
  const noMatchCases = gold.cases.filter(
    (testCase) => testCase.gold.expectedAction === 'no_match',
  );

  let overallCorrect = 0;
  let actionCorrect = 0;
  let identityCorrect = 0;
  let top3Correct = 0;
  let clarificationCorrect = 0;
  let clarificationUxCorrect = 0;
  let noMatchCorrect = 0;
  let unsafeAutoResolve = 0;
  const failures = [];

  for (const testCase of gold.cases) {
    const prediction = predictionsByCase.get(testCase.caseId);
    const actionMatches = prediction.action === testCase.gold.expectedAction;
    const fullyCorrect = isCaseCorrect(testCase, prediction);
    if (actionMatches) actionCorrect += 1;
    if (fullyCorrect) overallCorrect += 1;
    if (!fullyCorrect) {
      failures.push({
        caseId: testCase.caseId,
        expectedAction: testCase.gold.expectedAction,
        actualAction: prediction.action,
        expectedIdentityId: testCase.gold.identityId,
        actualIdentityId: prediction.selectedIdentityId ?? null,
      });
    }

    if (testCase.gold.expectedAction === 'resolve') {
      if (
        prediction.action === 'resolve' &&
        prediction.selectedIdentityId === testCase.gold.identityId
      )
        identityCorrect += 1;
      if (
        prediction.selectedIdentityId === testCase.gold.identityId ||
        prediction.candidateIdentityIds
          .slice(0, 3)
          .includes(testCase.gold.identityId)
      ) {
        top3Correct += 1;
      }
    } else if (prediction.action === 'resolve') {
      unsafeAutoResolve += 1;
    }

    if (
      testCase.gold.expectedAction === 'clarify' &&
      prediction.action === 'clarify'
    ) {
      clarificationCorrect += 1;
      if (isClarificationUxCorrect(testCase, prediction))
        clarificationUxCorrect += 1;
    }
    if (
      testCase.gold.expectedAction === 'no_match' &&
      prediction.action === 'no_match'
    )
      noMatchCorrect += 1;
  }

  const metrics = {
    overallAccuracy: round(ratio(overallCorrect, gold.cases.length)),
    actionAccuracy: round(ratio(actionCorrect, gold.cases.length)),
    resolvedIdentityAccuracy: round(
      ratio(identityCorrect, resolveCases.length),
    ),
    top3TargetRecall: round(ratio(top3Correct, resolveCases.length)),
    clarificationAccuracy: round(
      ratio(clarificationCorrect, clarifyCases.length),
    ),
    clarificationUxAccuracy: round(
      ratio(clarificationUxCorrect, clarifyCases.length),
    ),
    noMatchAccuracy: round(ratio(noMatchCorrect, noMatchCases.length)),
    unsafeAutoResolveRate: round(
      ratio(unsafeAutoResolve, clarifyCases.length + noMatchCases.length),
    ),
  };

  const thresholdResults = Object.fromEntries(
    Object.entries(thresholds).map(([metric, threshold]) => {
      const value = metrics[metric];
      assert(
        typeof value === 'number',
        `threshold references unavailable metric: ${metric}`,
      );
      const passes =
        metric === 'unsafeAutoResolveRate'
          ? value <= threshold
          : value >= threshold;
      return [metric, { value, threshold, passes }];
    }),
  );

  return {
    datasetId: gold.datasetId,
    counts: {
      total: gold.cases.length,
      resolve: resolveCases.length,
      clarify: clarifyCases.length,
      noMatch: noMatchCases.length,
    },
    metrics,
    thresholds: thresholdResults,
    passes: Object.values(thresholdResults).every((result) => result.passes),
    failures,
    byTag: scoreTagSlices(gold.cases, predictionsByCase),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const [goldPath, predictionPath] = process.argv.slice(2);
  if (!goldPath || !predictionPath) {
    throw new Error(
      'Usage: node score-place-resolution.mjs <gold.json> <predictions.json>',
    );
  }
  const report = scorePlaceResolution(
    await readJson(goldPath),
    await readJson(predictionPath),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passes) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
