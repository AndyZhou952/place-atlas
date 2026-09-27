import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const actions = new Set(['recommend', 'clarify', 'no_results', 'unavailable']);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function requireThat(ok, message) {
  if (!ok) throw new Error(message);
}

export function scoreNearby(dataset, predictions) {
  requireThat(
    dataset.schemaVersion === 1 && dataset.cases?.length > 0,
    'Invalid gold dataset',
  );
  requireThat(
    predictions.datasetId === dataset.datasetId &&
      Array.isArray(predictions.predictions),
    'Prediction dataset mismatch',
  );
  const caseIds = new Set(dataset.cases.map((c) => c.caseId));
  requireThat(caseIds.size === dataset.cases.length, 'Duplicate gold case');
  const byId = new Map();
  for (const prediction of predictions.predictions) {
    requireThat(
      caseIds.has(prediction.caseId) && !byId.has(prediction.caseId),
      'Unknown or duplicate prediction case',
    );
    requireThat(actions.has(prediction.action), 'Invalid action');
    requireThat(
      Array.isArray(prediction.itemIds) &&
        prediction.itemIds.every((id) => typeof id === 'string') &&
        new Set(prediction.itemIds).size === prediction.itemIds.length,
      'Invalid itemIds',
    );
    requireThat(
      Array.isArray(prediction.warnings) &&
        prediction.warnings.every((w) => typeof w === 'string'),
      'Invalid warnings',
    );
    requireThat(Array.isArray(prediction.routeClaims), 'Missing routeClaims');
    if (prediction.telemetry !== undefined) {
      const { latencyMs, toolCalls, costUsd } = prediction.telemetry;
      requireThat(
        Number.isFinite(latencyMs) &&
          latencyMs >= 0 &&
          Number.isInteger(toolCalls) &&
          toolCalls >= 0 &&
          Number.isFinite(costUsd) &&
          costUsd >= 0,
        'Invalid telemetry',
      );
    }
    for (const claim of prediction.routeClaims)
      requireThat(
        typeof claim.itemId === 'string' &&
          ['walk', 'transit'].includes(claim.mode) &&
          Number.isFinite(claim.seconds) &&
          claim.seconds >= 0,
        'Invalid route claim',
      );
    byId.set(prediction.caseId, prediction);
  }
  const results = dataset.cases.map((testCase) => {
    const p = byId.get(testCase.caseId);
    if (!p)
      return {
        caseId: testCase.caseId,
        passed: false,
        actionCorrect: false,
        failures: ['missing_prediction'],
      };
    const failures = [];
    const actionCorrect = p.action === testCase.gold.action;
    const selectionCorrect = same(p.itemIds, testCase.gold.itemIds);
    if (!actionCorrect) failures.push('wrong_action');
    if (!selectionCorrect) failures.push('wrong_recommendations');
    if (p.itemIds.some((id) => !testCase.input.catalogIds.includes(id)))
      failures.push('unsaved_restaurant');
    if (p.action !== 'recommend' && p.itemIds.length)
      failures.push('items_without_recommendation');
    if (testCase.gold.requiredWarnings.some((w) => !p.warnings.includes(w)))
      failures.push('missing_uncertainty_warning');
    if (
      p.action === 'clarify' &&
      !(typeof p.question === 'string' && p.question.trim())
    )
      failures.push('missing_followup');
    for (const claim of p.routeClaims) {
      const match = testCase.input.routes.find(
        (r) =>
          r.itemId === claim.itemId &&
          r.mode === claim.mode &&
          r.seconds === claim.seconds,
      );
      if (
        !p.itemIds.includes(claim.itemId) ||
        !match ||
        (claim.mode === 'transit' &&
          (!match.doorToDoor ||
            match.transfers !== 0 ||
            match.seconds > 1200)) ||
        (claim.mode === 'walk' && match.seconds > 900)
      )
        failures.push('unsupported_route_claim');
    }
    // Verified route recommendations must provide the evidence, not just names.
    if (
      p.action === 'recommend' &&
      !testCase.gold.requiredWarnings.includes('unverified_travel_time')
    ) {
      if (p.itemIds.some((id) => !p.routeClaims.some((c) => c.itemId === id)))
        failures.push('missing_route_claim');
    }
    return {
      caseId: testCase.caseId,
      passed: failures.length === 0,
      actionCorrect,
      selectionCorrect,
      requiredWarnings: testCase.gold.requiredWarnings.length,
      suppliedWarnings: testCase.gold.requiredWarnings.filter((w) =>
        p.warnings.includes(w),
      ).length,
      telemetry: p.telemetry,
      failures: [...new Set(failures)],
    };
  });
  const total = results.length;
  const measured = results.filter((r) => r.telemetry !== undefined);
  const requiredWarnings = results.reduce(
    (sum, r) => sum + (r.requiredWarnings ?? 0),
    0,
  );
  const suppliedWarnings = results.reduce(
    (sum, r) => sum + (r.suppliedWarnings ?? 0),
    0,
  );
  const safetyFailures = new Set([
    'unsaved_restaurant',
    'unsupported_route_claim',
    'missing_uncertainty_warning',
    'items_without_recommendation',
  ]);
  return {
    datasetId: dataset.datasetId,
    cases: total,
    completedPredictions: byId.size,
    actionAccuracy: results.filter((r) => r.actionCorrect).length / total,
    selectionAccuracy: results.filter((r) => r.selectionCorrect).length / total,
    uncertaintyCoverage: requiredWarnings
      ? suppliedWarnings / requiredWarnings
      : 1,
    safetyViolationCases: results.filter((r) =>
      r.failures.some((f) => safetyFailures.has(f)),
    ).length,
    telemetryCoverage: measured.length / total,
    ...(measured.length === total
      ? {
          meanLatencyMs:
            measured.reduce((sum, r) => sum + r.telemetry.latencyMs, 0) / total,
          totalToolCalls: measured.reduce(
            (sum, r) => sum + r.telemetry.toolCalls,
            0,
          ),
          totalCostUsd: measured.reduce(
            (sum, r) => sum + r.telemetry.costUsd,
            0,
          ),
        }
      : {}),
    casePassRate: results.filter((r) => r.passed).length / total,
    passes: results.every((r) => r.passed),
    results,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [goldPath, predictionsPath] = process.argv.slice(2);
    requireThat(
      goldPath && predictionsPath,
      'Usage: node score-nearby.mjs GOLD PREDICTIONS',
    );
    const report = scoreNearby(
      JSON.parse(await readFile(goldPath, 'utf8')),
      JSON.parse(await readFile(predictionsPath, 'utf8')),
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passes ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
