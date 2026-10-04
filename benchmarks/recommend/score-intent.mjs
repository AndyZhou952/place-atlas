import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const sameSet = (left, right) =>
  Array.isArray(left) &&
  new Set(left).size === left.length &&
  left.length === right.length &&
  right.every((value) => left.includes(value));

export function scoreRecommendIntent(dataset, predictionFile) {
  if (
    dataset.schemaVersion !== 1 ||
    !Array.isArray(dataset.cases) ||
    !dataset.cases.length ||
    !Array.isArray(dataset.originOptions) ||
    predictionFile.datasetId !== dataset.datasetId ||
    !Array.isArray(predictionFile.predictions)
  )
    throw new Error('Invalid intent dataset or prediction file');

  const originIds = new Set(dataset.originOptions.map((origin) => origin.id));
  const caseIds = new Set(dataset.cases.map((entry) => entry.caseId));
  if (
    originIds.size !== dataset.originOptions.length ||
    caseIds.size !== dataset.cases.length
  )
    throw new Error('Duplicate gold origin or case');

  const byId = new Map();
  for (const prediction of predictionFile.predictions) {
    if (!caseIds.has(prediction.caseId) || byId.has(prediction.caseId))
      throw new Error('Unknown or duplicate prediction case');
    byId.set(prediction.caseId, prediction);
  }

  const results = dataset.cases.map((entry) => {
    const prediction = byId.get(entry.caseId);
    if (!prediction)
      return {
        caseId: entry.caseId,
        passed: false,
        failures: ['missing_prediction'],
      };
    const expected = entry.gold;
    const failures = [];
    const actionCorrect = prediction.action === expected.action;
    const originCorrect = prediction.originId === expected.originId;
    const foodCorrect =
      sameSet(prediction.foodTerms, expected.foodTerms) &&
      sameSet(prediction.excludedFoodTerms, expected.excludedFoodTerms);
    const travelCorrect =
      prediction.travelMode === expected.travelMode &&
      prediction.maxMinutes === expected.maxMinutes;
    const visitedCorrect = prediction.visited === expected.visited;
    if (!actionCorrect) failures.push('wrong_action');
    if (!originCorrect) failures.push('wrong_origin');
    if (!foodCorrect) failures.push('wrong_food_terms');
    if (!travelCorrect) failures.push('wrong_travel_constraint');
    if (!visitedCorrect) failures.push('wrong_visited_preference');
    if (prediction.originId !== null && !originIds.has(prediction.originId))
      failures.push('invented_origin');
    if (prediction.action === 'clarify') {
      if (
        typeof prediction.question !== 'string' ||
        !prediction.question.trim()
      )
        failures.push('missing_question');
      if (prediction.clarification !== expected.clarification)
        failures.push('wrong_clarification');
    }
    if (
      prediction.action === 'unsupported' &&
      prediction.reason !== expected.reason
    )
      failures.push('wrong_unsupported_reason');
    if (
      prediction.routeClaims?.length ||
      prediction.itemIds?.length ||
      prediction.travelTimeMinutes !== undefined
    )
      failures.push('premature_restaurant_or_route_claim');
    const originKind = dataset.originOptions.find(
      (origin) => origin.id === prediction.originId,
    )?.kind;
    if (
      prediction.action === 'recommend' &&
      originKind === 'area' &&
      prediction.travelMode !== 'none'
    )
      failures.push('timed_route_from_broad_area');
    return {
      caseId: entry.caseId,
      passed: failures.length === 0,
      actionCorrect,
      originCorrect,
      foodCorrect,
      travelCorrect,
      visitedCorrect,
      failures,
    };
  });
  const rate = (key) =>
    results.filter((entry) => entry[key] === true).length / results.length;
  const safetyFailures = new Set([
    'invented_origin',
    'premature_restaurant_or_route_claim',
    'timed_route_from_broad_area',
  ]);
  return {
    datasetId: dataset.datasetId,
    cases: results.length,
    completedPredictions: byId.size,
    actionAccuracy: rate('actionCorrect'),
    originAccuracy: rate('originCorrect'),
    foodTermAccuracy: rate('foodCorrect'),
    travelAccuracy: rate('travelCorrect'),
    visitedAccuracy: rate('visitedCorrect'),
    safetyViolationCases: results.filter((entry) =>
      entry.failures.some((failure) => safetyFailures.has(failure)),
    ).length,
    casePassRate:
      results.filter((entry) => entry.passed).length / results.length,
    passes: results.every((entry) => entry.passed),
    results,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  try {
    const [goldPath, predictionsPath] = process.argv.slice(2);
    if (!goldPath || !predictionsPath)
      throw new Error('Usage: node score-intent.mjs GOLD PREDICTIONS');
    const report = scoreRecommendIntent(
      JSON.parse(await readFile(goldPath, 'utf8')),
      JSON.parse(await readFile(predictionsPath, 'utf8')),
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passes ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
