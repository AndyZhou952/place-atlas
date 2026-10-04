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
  else if (expected.secondStatus === 'clarify') {
    requests.push({ query, replies: [answers[0]] });
    requests.push({
      query,
      replies: answers,
      originChoice: { hint: expected.choiceHint, id: expected.choiceId },
    });
  } else if (answers.length) requests.push({ query, replies: answers });
  const responses = [];
  if (expected.firstStatus === 'clarify')
    responses.push({
      status: 'clarify',
      clarification: expected.clarification,
      question: 'Which exact starting point?',
    });
  if (expected.secondStatus === 'clarify')
    responses.push({
      status: 'clarify',
      clarification: expected.secondClarification,
      question: 'Which exact location is your starting point?',
      originHint: expected.choiceHint,
      options: [{ id: expected.choiceId, label: expected.choiceId }],
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
              ...(expected.address ? { address: expected.address } : {}),
              reason: expected.reasonIncludes
                ? `Saved restaurant; ${expected.reasonIncludes} from your origin.`
                : 'Matches your saved catalog and stated request.',
              ...(expected.routeMode
                ? {
                    route: {
                      mode: expected.routeMode,
                      seconds: expected.maxRouteSeconds,
                      checkedAt: '2026-09-30T00:00:00.000Z',
                      source: {
                        label: 'Google Maps',
                        url: 'https://www.google.com/maps',
                      },
                    },
                  }
                : {}),
            },
          ],
          ...(expected.warningIncludes
            ? { warnings: [expected.warningIncludes] }
            : {}),
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
        ? { displayedRouteText: expected.displayIncludes.join(' · ') }
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
  assert.equal(report.cases, 14);
  assert.equal(report.casePassRate, 1);
});

test('a copied street address cannot silently become a broad-area answer', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'pasted-street-address-overrides-catalog-area',
  );
  const prediction = oracle(entry);
  prediction.trace.responses[0].recommendations[0].reason =
    'Saved restaurant in the matching area.';
  delete prediction.trace.responses[0].warnings;
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, [
    'missing_distance_evidence',
    'missing_uncertainty_warning',
  ]);
});

test('a walking claim without verified route evidence fails the journey contract', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'direct-walk-canonical-route',
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

test('an exact display name cannot hide the wrong saved branch address', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'branch-choice-continuation',
  );
  const prediction = oracle(entry);
  prediction.trace.responses.at(-1).recommendations[0].address =
    'Fixture address: another branch';
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, ['wrong_saved_address']);
});

test('a geocoder choice must carry the selected ID through the API', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'ambiguous-station-choice-continues',
  );
  const prediction = oracle(entry);
  delete prediction.trace.requests[2].originChoice;
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, ['origin_choice_not_preserved']);
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

test('a default-distance answer needs distance evidence and a time caveat', () => {
  const entry = dataset.cases.find(
    ({ caseId }) =>
      caseId === 'station-origin-default-distance-with-saved-cafe',
  );
  const prediction = oracle(entry);
  prediction.trace.responses[0].recommendations[0].reason =
    'Saved cafe near your starting point.';
  delete prediction.trace.responses[0].warnings;
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, [
    'missing_distance_evidence',
    'missing_uncertainty_warning',
  ]);
});

test('a default-distance answer cannot add a timed route claim', () => {
  const entry = dataset.cases.find(
    ({ caseId }) =>
      caseId === 'station-origin-default-distance-with-saved-cafe',
  );
  const prediction = oracle(entry);
  prediction.trace.responses[0].recommendations[0].route = {
    mode: 'drive',
    seconds: 480,
    checkedAt: '2026-09-30T00:00:00.000Z',
    source: { label: 'Google Maps', url: 'https://www.google.com/maps' },
  };
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, [
    'unsupported_route_mode',
    'unexpected_route_claim',
  ]);
});

test('current journey contract rejects an unsupported route claim on another result', () => {
  const entry = dataset.cases.find(
    ({ caseId }) => caseId === 'direct-walk-canonical-route',
  );
  const prediction = oracle(entry);
  prediction.trace.responses[0].recommendations.push({
    itemId: 'another-saved-place',
    detailTargetId: 'another-saved-place',
    name: 'Another saved place',
    reason: 'Nearby',
    route: { mode: 'drive', seconds: 480 },
  });
  const report = scoreRecommendContract(
    { ...dataset, cases: [entry] },
    { datasetId: dataset.datasetId, predictions: [prediction] },
  );
  assert.deepEqual(report.results[0].failures, ['unsupported_route_mode']);
});

test('distance answer fails if the browser shows an invented duration', () => {
  const entry = dataset.cases.find(
    ({ caseId }) =>
      caseId === 'station-origin-default-distance-with-saved-cafe',
  );
  for (const duration of ['5 min', '徒歩5分']) {
    const prediction = oracle(entry);
    prediction.trace.displayedRouteText += ` · ${duration}`;
    const report = scoreRecommendContract(
      { ...dataset, cases: [entry] },
      { datasetId: dataset.datasetId, predictions: [prediction] },
    );
    assert.deepEqual(report.results[0].failures, ['unsupported_time_display']);
  }
});
