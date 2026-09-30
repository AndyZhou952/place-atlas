import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function scoreRecommendContract(dataset, predictionFile) {
  if (
    dataset.schemaVersion !== 1 ||
    !Array.isArray(dataset.cases) ||
    !dataset.cases.length ||
    predictionFile.datasetId !== dataset.datasetId ||
    !Array.isArray(predictionFile.predictions)
  )
    throw new Error('Invalid contract dataset or prediction file');
  const caseIds = new Set(dataset.cases.map((entry) => entry.caseId));
  if (caseIds.size !== dataset.cases.length)
    throw new Error('Duplicate contract case');
  const predictions = new Map();
  for (const prediction of predictionFile.predictions) {
    if (!caseIds.has(prediction.caseId) || predictions.has(prediction.caseId))
      throw new Error('Unknown or duplicate contract prediction');
    predictions.set(prediction.caseId, prediction);
  }
  const results = dataset.cases.map((entry) => {
    const prediction = predictions.get(entry.caseId);
    if (!prediction)
      return {
        caseId: entry.caseId,
        passed: false,
        failures: ['missing_prediction'],
      };
    const failures = [];
    const trace = prediction.trace;
    const requests = Array.isArray(trace?.requests) ? trace.requests : [];
    const responses = Array.isArray(trace?.responses) ? trace.responses : [];
    const expected = entry.expected;
    const final = responses.at(-1);
    if (entry.scenario && trace?.scenario !== entry.scenario)
      failures.push('wrong_provider_scenario');
    if (!same(requests[0], { query: entry.query, replies: [] }))
      failures.push('incorrect_initial_request');
    if (expected.resetBeforeAnswer) {
      if (
        !same(requests[1], { query: entry.answers[0], replies: [] }) ||
        trace?.reset !== true
      )
        failures.push('reset_did_not_discard_context');
    } else if (expected.secondStatus === 'clarify') {
      if (
        !same(requests[1], {
          query: entry.query,
          replies: [entry.answers[0]],
        }) ||
        !same(requests[2], {
          query: entry.query,
          replies: entry.answers,
          originChoice: {
            hint: expected.choiceHint,
            id: expected.choiceId,
          },
        })
      )
        failures.push('origin_choice_not_preserved');
      if (
        responses[1]?.status !== 'clarify' ||
        responses[1]?.clarification !== expected.secondClarification ||
        responses[1]?.originHint !== expected.choiceHint ||
        !responses[1]?.options?.some(
          (option) => option.id === expected.choiceId,
        )
      )
        failures.push('missing_or_wrong_origin_choices');
    } else if (entry.answers.length) {
      if (
        !same(requests[1], {
          query: entry.query,
          replies: entry.answers,
        })
      )
        failures.push('reply_lost_initial_request');
    }
    if (expected.firstStatus === 'clarify') {
      if (
        responses[0]?.status !== 'clarify' ||
        responses[0]?.clarification !== expected.clarification ||
        typeof responses[0]?.question !== 'string' ||
        !responses[0].question.trim()
      )
        failures.push('missing_or_wrong_clarification');
    }
    if (final?.status !== expected.status) failures.push('wrong_final_status');
    if (expected.status === 'unavailable') {
      if (
        typeof expected.retryable === 'boolean' &&
        final?.retryable !== expected.retryable
      )
        failures.push('wrong_retryability');
      if (
        expected.messageIncludes &&
        !final?.message?.includes(expected.messageIncludes)
      )
        failures.push('missing_coverage_explanation');
    }
    if (expected.status === 'clarify') {
      if (
        final?.clarification !== expected.clarification ||
        typeof final?.question !== 'string' ||
        !final.question.trim()
      )
        failures.push('missing_repeat_question');
    }
    if (expected.status === 'recommend') {
      const recommendation = final?.recommendations?.[0];
      if (
        recommendation?.itemId !== expected.itemId ||
        recommendation?.detailTargetId !== expected.detailTargetId
      )
        failures.push('wrong_saved_item_or_detail_target');
      if (recommendation?.name !== expected.name)
        failures.push('wrong_canonical_name');
      if (expected.address && recommendation?.address !== expected.address)
        failures.push('wrong_saved_address');
      if (
        expected.reasonRequired &&
        (typeof recommendation?.reason !== 'string' ||
          !recommendation.reason.trim())
      )
        failures.push('missing_reason');
      if (expected.routeMode) {
        const route = recommendation?.route;
        if (
          route?.mode !== expected.routeMode ||
          typeof route?.seconds !== 'number' ||
          !Number.isFinite(route.seconds) ||
          route.seconds > expected.maxRouteSeconds ||
          typeof route?.source?.url !== 'string' ||
          !route.source.url.startsWith('https://') ||
          !Number.isFinite(Date.parse(route?.checkedAt))
        )
          failures.push('missing_verified_route');
        if (
          expected.routeEstimateBasis &&
          route?.estimateBasis !== expected.routeEstimateBasis
        )
          failures.push('missing_route_estimate_basis');
        if (
          expected.routeSourceLabel &&
          route?.source?.label !== expected.routeSourceLabel
        )
          failures.push('wrong_route_source');
        if (
          expected.routeEstimateBasis === 'average' &&
          !/estimated|average|approx|約|目安/iu.test(
            recommendation?.reason ?? '',
          )
        )
          failures.push('reason_claims_precise_route');
      }
      if (
        expected.displayIncludes &&
        !trace?.displayedRouteText?.includes(expected.displayIncludes)
      )
        failures.push('missing_display_disclosure');
      if (trace?.openedDetailId !== expected.detailTargetId)
        failures.push('detail_not_opened');
    } else if (final?.recommendations?.length)
      failures.push('recommendations_with_nonrecommend_status');
    if (expected.retryKeepsDraft && trace?.retryDraft !== entry.query)
      failures.push('retry_lost_draft');
    if (expected.keyboardSubmit && trace?.keyboardSubmitted !== true)
      failures.push('keyboard_reply_unavailable');
    return {
      caseId: entry.caseId,
      passed: failures.length === 0,
      failures,
    };
  });
  return {
    datasetId: dataset.datasetId,
    cases: results.length,
    completedPredictions: predictions.size,
    casePassRate:
      results.filter((result) => result.passed).length / results.length,
    passes: results.every((result) => result.passed),
    results,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  try {
    const [goldPath, predictionsPath] = process.argv.slice(2);
    if (!goldPath || !predictionsPath)
      throw new Error('Usage: node score-contract.mjs GOLD PREDICTIONS');
    const report = scoreRecommendContract(
      JSON.parse(await readFile(goldPath, 'utf8')),
      JSON.parse(await readFile(predictionsPath, 'utf8')),
    );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passes ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
