import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { scoreRecommendContract } from './score-contract.mjs';

const dataset = JSON.parse(
  readFileSync(new URL('./contract-gold.v1.json', import.meta.url), 'utf8'),
);

function oracle(entry) {
  const { query, answers, expected } = entry;
  const requests = [{ query, replies: [] }];
  if (expected.resetBeforeAnswer)
    requests.push({ query: answers[0], replies: [] });
  else if (answers.length) requests.push({ query, replies: answers });
  const responses = [];
  if (expected.firstStatus === 'clarify')
    responses.push({
      status: 'clarify',
      clarification: expected.clarification,
      question: 'Which exact starting point?',
    });
  responses.push(
    expected.status === 'recommend'
      ? {
          status: 'recommend',
          recommendations: [
            {
              itemId: expected.itemId,
              detailTargetId: expected.detailTargetId,
              name: expected.name,
              reason: expected.routeEstimateBasis
                ? 'Saved restaurant; estimated direct train route.'
                : 'Matches your saved catalog and stated request.',
              ...(expected.routeMode
                ? {
                    route: {
                      mode: expected.routeMode,
                      seconds: expected.maxRouteSeconds,
                      checkedAt: '2026-09-30T00:00:00.000Z',
                      source: {
                        label: expected.routeSourceLabel ?? 'Google Maps',
                        url: expected.routeSourceLabel
                          ? 'https://www.navitime.co.jp/'
                          : 'https://www.google.com/maps',
                      },
                      ...(expected.routeEstimateBasis
                        ? { estimateBasis: expected.routeEstimateBasis }
                        : {}),
                    },
                  }
                : {}),
            },
          ],
        }
      : expected.status === 'clarify'
        ? {
            status: 'clarify',
            clarification: expected.clarification,
            question: 'Which exact starting point?',
          }
        : {
            status: expected.status,
            recommendations: [],
            ...(typeof expected.retryable === 'boolean'
              ? { retryable: expected.retryable }
              : {}),
            ...(expected.messageIncludes
              ? { message: `${expected.messageIncludes} from this provider.` }
              : {}),
          },
  );
  return {
    caseId: entry.caseId,
    trace: {
      requests,
      responses,
      ...(entry.scenario ? { scenario: entry.scenario } : {}),
      ...(expected.displayIncludes
        ? { displayedRouteText: expected.displayIncludes }
        : {}),
      ...(expected.status === 'recommend'
        ? { openedDetailId: expected.detailTargetId }
        : {}),
      ...(expected.retryKeepsDraft ? { retryDraft: query } : {}),
      ...(expected.keyboardSubmit ? { keyboardSubmitted: true } : {}),
      ...(expected.resetBeforeAnswer ? { reset: true } : {}),
    },
  };
}

test('all browser and API contract cases have a valid oracle trace', () => {
  const report = scoreRecommendContract(dataset, {
    datasetId: dataset.datasetId,
    predictions: dataset.cases.map(oracle),
  });
  assert.equal(report.cases, 13);
  assert.equal(report.casePassRate, 1);
});

test('a Japan average route cannot pass as a precise train-time claim', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'japan-direct-train-average-disclosure',
  );
  const prediction = oracle(entry);
  const recommendation = prediction.trace.responses[0].recommendations[0];
  delete recommendation.route.estimateBasis;
  recommendation.reason = 'Verified direct train route 18 min.';
  delete prediction.trace.displayedRouteText;
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, [
    'missing_route_estimate_basis',
    'reason_claims_precise_route',
    'missing_display_disclosure',
  ]);
});

test('a train claim without verified route evidence fails the journey contract', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'direct-train-canonical-route',
  );
  const prediction = oracle(entry);
  delete prediction.trace.responses[0].recommendations[0].route;
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, ['missing_verified_route']);
});

test('a model-style display name cannot pass even with a valid saved ID', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'one-turn-saved-detail',
  );
  const prediction = oracle(entry);
  prediction.trace.responses[0].recommendations[0].name = 'Invented alias';
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, ['wrong_canonical_name']);
});

test('lost query context and wrong detail click fail separately', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'origin-free-text-continuation',
  );
  const prediction = oracle(entry);
  prediction.trace.requests[1] = { query: '新宿三丁目駅', replies: [] };
  prediction.trace.openedDetailId = 'another-saved-item';
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, [
    'reply_lost_initial_request',
    'detail_not_opened',
  ]);
});

test('an unsupported region cannot pass as empty results or a retryable outage', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'japan-transit-unsupported-with-saved-cafe',
  );
  const prediction = oracle(entry);
  prediction.trace.responses[0] = {
    status: 'no_results',
    retryable: true,
    message: 'No saved restaurants match this request yet.',
  };
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, [
    'wrong_final_status',
    'wrong_retryability',
    'missing_coverage_explanation',
  ]);
});
