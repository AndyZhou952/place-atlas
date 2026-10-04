import { runScorerCli } from '../scorer-cli.mjs';

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

export function scoreNearbyLocation(dataset, predictions) {
  requireThat(
    dataset.schemaVersion === 1 &&
      dataset.cases?.length > 0 &&
      dataset.origins?.length > 0,
    'Invalid location dataset',
  );
  requireThat(
    predictions.datasetId === dataset.datasetId &&
      Array.isArray(predictions.predictions),
    'Prediction dataset mismatch',
  );
  const originIds = new Set(dataset.origins.map((origin) => origin.id));
  const caseIds = new Set(dataset.cases.map((entry) => entry.caseId));
  requireThat(originIds.size === dataset.origins.length, 'Duplicate origin');
  requireThat(caseIds.size === dataset.cases.length, 'Duplicate case');

  const byCaseId = new Map();
  for (const prediction of predictions.predictions) {
    requireThat(
      caseIds.has(prediction.caseId) && !byCaseId.has(prediction.caseId),
      'Unknown or duplicate prediction case',
    );
    requireThat(
      prediction.action === 'resolve' || prediction.action === 'clarify',
      'Invalid location action',
    );
    byCaseId.set(prediction.caseId, prediction);
  }

  const results = dataset.cases.map((entry) => {
    const prediction = byCaseId.get(entry.caseId);
    if (!prediction) {
      return {
        caseId: entry.caseId,
        actionCorrect: false,
        passed: false,
        failures: ['missing_prediction'],
      };
    }
    const failures = [];
    const actionCorrect = prediction.action === entry.gold.action;
    if (!actionCorrect) failures.push('wrong_action');
    if (prediction.originId && !originIds.has(prediction.originId)) {
      failures.push('invented_origin');
    }
    if (prediction.itemIds?.length || prediction.routeClaims?.length) {
      failures.push('unsupported_recommendation_or_route');
    }
    if (entry.gold.action === 'clarify') {
      if (prediction.originId) failures.push('premature_resolution');
      if (
        prediction.action === 'clarify' &&
        !(typeof prediction.question === 'string' && prediction.question.trim())
      ) {
        failures.push('missing_clarification_question');
      }
    } else {
      if (prediction.originId !== entry.gold.originId) {
        failures.push('wrong_origin');
      }
      if (prediction.cuisine !== entry.gold.cuisine) {
        failures.push('wrong_cuisine');
      }
      if (prediction.visited !== entry.gold.visited) {
        failures.push('wrong_visited_preference');
      }
    }
    return {
      caseId: entry.caseId,
      actionCorrect,
      passed: failures.length === 0,
      failures,
    };
  });

  return {
    datasetId: dataset.datasetId,
    cases: results.length,
    completedPredictions: byCaseId.size,
    actionAccuracy:
      results.filter((entry) => entry.actionCorrect).length / results.length,
    casePassRate:
      results.filter((entry) => entry.passed).length / results.length,
    passes: results.every((entry) => entry.passed),
    results,
  };
}

await runScorerCli(
  import.meta.url,
  scoreNearbyLocation,
  'Usage: node score-nearby-location.mjs GOLD PREDICTIONS',
);
