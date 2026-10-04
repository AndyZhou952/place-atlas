import { runScorerCli } from '../scorer-cli.mjs';

function supportedReasonFact(fact, item, input, routeClaim) {
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return false;
  switch (fact.kind) {
    case 'saved':
      return fact.value === true && item.verificationStatus === 'verified';
    case 'food':
      return typeof fact.value === 'string' && item.tags.includes(fact.value);
    case 'area':
      return fact.value === item.area;
    case 'unvisited':
      return fact.value === true && item.visited === false;
    case 'visited':
      return fact.value === true && item.visited === true;
    case 'walk':
      return (
        routeClaim?.mode === fact.kind && routeClaim.seconds === fact.seconds
      );
    case 'distance':
      return input.distances.some(
        (distance) =>
          distance.itemId === item.id &&
          distance.meters === fact.meters &&
          distance.meters <= 2000,
      );
    case 'entry_unknown':
      return (
        fact.value === true &&
        (input.entryState === 'unknown' ||
          (input.intent.askWalkIn === true && item.walkIn === 'unknown'))
      );
    case 'walk_in_known':
      return (
        fact.value === true &&
        input.intent.askWalkIn === true &&
        item.walkIn === 'known'
      );
    default:
      return false;
  }
}

function validRouteClaim(claim, itemId, input) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return false;
  const route = input.routes.find(
    (candidate) =>
      candidate.itemId === itemId &&
      candidate.mode === claim.mode &&
      candidate.seconds === claim.seconds &&
      candidate.status === 'fresh',
  );
  if (!route) return false;
  const { travelMode, maxMinutes } = input.intent;
  if (
    !['walk', 'either'].includes(travelMode) ||
    claim.mode !== 'walk' ||
    (Number.isFinite(maxMinutes) && claim.seconds > maxMinutes * 60)
  )
    return false;
  return true;
}

export function scoreRecommendDecision(dataset, predictionFile) {
  if (
    dataset.schemaVersion !== 1 ||
    !Array.isArray(dataset.cases) ||
    !dataset.cases.length ||
    !Array.isArray(dataset.catalog) ||
    predictionFile.datasetId !== dataset.datasetId ||
    !Array.isArray(predictionFile.predictions)
  )
    throw new Error('Invalid decision dataset or prediction file');
  const caseIds = new Set(dataset.cases.map((entry) => entry.caseId));
  const catalog = new Map(dataset.catalog.map((item) => [item.id, item]));
  if (
    caseIds.size !== dataset.cases.length ||
    catalog.size !== dataset.catalog.length
  )
    throw new Error('Duplicate gold case or restaurant');
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
    const failures = [];
    const recommendations = Array.isArray(prediction.recommendations)
      ? prediction.recommendations
      : [];
    const warnings = Array.isArray(prediction.warnings)
      ? prediction.warnings
      : [];
    const actionCorrect = prediction.action === entry.gold.action;
    const selectedIds = recommendations.map((item) => item?.itemId);
    const selectionCorrect =
      entry.gold.action === 'recommend'
        ? entry.gold.topItemIds.includes(selectedIds[0]) &&
          selectedIds.every((id) => entry.gold.allowedItemIds.includes(id))
        : selectedIds.length === 0;
    if (!actionCorrect) failures.push('wrong_action');
    if (!selectionCorrect) failures.push('wrong_selection');
    if (
      recommendations.length > 5 ||
      new Set(selectedIds).size !== selectedIds.length
    )
      failures.push('duplicate_or_excess_recommendations');
    if (prediction.action !== 'recommend' && recommendations.length)
      failures.push('items_without_recommendation');
    if (
      prediction.action === 'clarify' &&
      (typeof prediction.question !== 'string' || !prediction.question.trim())
    )
      failures.push('missing_question');
    for (const required of entry.gold.requiredWarnings) {
      if (!warnings.includes(required))
        failures.push('missing_uncertainty_warning');
    }
    for (const recommendation of recommendations) {
      const item = catalog.get(recommendation?.itemId);
      if (
        !item ||
        !entry.input.catalogIds.includes(recommendation.itemId) ||
        item.kind !== 'food' ||
        item.verificationStatus !== 'verified'
      ) {
        failures.push('unsaved_or_unverified_restaurant');
        continue;
      }
      if (recommendation.detailTargetId !== item.id)
        failures.push('wrong_detail_target');
      if (
        typeof recommendation.reason !== 'string' ||
        !recommendation.reason.trim() ||
        recommendation.reason.length > 180
      )
        failures.push('missing_or_oversized_reason');
      if (
        !Array.isArray(recommendation.reasonFacts) ||
        !recommendation.reasonFacts.length ||
        recommendation.reasonFacts.some(
          (fact) =>
            !supportedReasonFact(
              fact,
              item,
              entry.input,
              recommendation.routeClaim,
            ),
        )
      )
        failures.push('unsupported_reason_fact');
      const intent = entry.input.intent;
      const facts = Array.isArray(recommendation.reasonFacts)
        ? recommendation.reasonFacts
        : [];
      if (
        (intent.foodTerms.length > 0 &&
          !facts.some(
            (fact) =>
              fact?.kind === 'food' && intent.foodTerms.includes(fact.value),
          )) ||
        (entry.input.origin.state === 'area' &&
          !facts.some((fact) => fact?.kind === 'area')) ||
        (recommendation.routeClaim &&
          !facts.some(
            (fact) => fact?.kind === recommendation.routeClaim.mode,
          )) ||
        (!recommendation.routeClaim &&
          entry.input.origin.state === 'resolved' &&
          !facts.some((fact) => fact?.kind === 'distance'))
      )
        failures.push('missing_relevant_reason_fact');
      if (
        (intent.foodTerms.length &&
          !intent.foodTerms.some((term) => item.tags.includes(term))) ||
        intent.excludedFoodTerms.some((term) => item.tags.includes(term))
      )
        failures.push('food_constraint_violation');
      if (
        entry.input.origin.state === 'area' &&
        item.area !== entry.input.origin.id
      )
        failures.push('area_constraint_violation');
      if (
        (intent.visited === 'only_visited' && !item.visited) ||
        (intent.visited === 'only_unvisited' && item.visited)
      )
        failures.push('visited_constraint_violation');
      if (intent.askWalkIn === true && item.walkIn === 'excluded')
        failures.push('walk_in_constraint_violation');
      if (
        intent.askWalkIn === true &&
        item.walkIn === 'known' &&
        !facts.some((fact) => fact?.kind === 'walk_in_known')
      )
        failures.push('missing_walk_in_evidence');
      if (
        intent.askWalkIn === true &&
        item.walkIn === 'unknown' &&
        (!facts.some((fact) => fact?.kind === 'entry_unknown') ||
          !warnings.includes('walk_in_unknown'))
      )
        failures.push('unknown_entry_not_disclosed');
      if (recommendation.routeClaim) {
        if (
          entry.input.origin.state !== 'resolved' ||
          !validRouteClaim(recommendation.routeClaim, item.id, entry.input)
        )
          failures.push('unsupported_route_claim');
      } else if (entry.input.origin.state === 'resolved') {
        const distance = entry.input.distances.find(
          (candidate) => candidate.itemId === item.id,
        );
        if (
          !['either', 'none'].includes(intent.travelMode) ||
          !distance ||
          distance.meters > 2000 ||
          !warnings.includes('unverified_travel_time')
        )
          failures.push('unverified_route_without_label');
      }
    }
    return {
      caseId: entry.caseId,
      passed: failures.length === 0,
      actionCorrect,
      selectionCorrect,
      failures: [...new Set(failures)],
    };
  });
  const safetyFailures = new Set([
    'unsaved_or_unverified_restaurant',
    'wrong_detail_target',
    'unsupported_reason_fact',
    'missing_relevant_reason_fact',
    'food_constraint_violation',
    'area_constraint_violation',
    'visited_constraint_violation',
    'walk_in_constraint_violation',
    'missing_walk_in_evidence',
    'unknown_entry_not_disclosed',
    'unsupported_route_claim',
    'unverified_route_without_label',
    'missing_uncertainty_warning',
  ]);
  const total = results.length;
  return {
    datasetId: dataset.datasetId,
    cases: total,
    completedPredictions: byId.size,
    actionAccuracy:
      results.filter((result) => result.actionCorrect).length / total,
    selectionAccuracy:
      results.filter((result) => result.selectionCorrect).length / total,
    safetyViolationCases: results.filter((result) =>
      result.failures.some((failure) => safetyFailures.has(failure)),
    ).length,
    casePassRate: results.filter((result) => result.passed).length / total,
    passes: results.every((result) => result.passed),
    results,
  };
}

await runScorerCli(
  import.meta.url,
  scoreRecommendDecision,
  'Usage: node score-decision.mjs GOLD PREDICTIONS',
);
