import assert from 'node:assert/strict';
import test from 'node:test';

import {
  baselineCaseInput,
  runBaselineDataset,
} from './run-deepseek-baseline.mjs';

const policyDataset = {
  schemaVersion: 1,
  datasetId: 'policy-test',
  catalog: [{ id: 'saved-a', visited: false, tags: ['ramen'] }],
  cases: [
    {
      caseId: 'empty',
      input: {
        message: 'nearby?',
        locationState: 'resolved',
        catalogIds: [],
        routes: [],
      },
      gold: { action: 'no_results', itemIds: [], requiredWarnings: [] },
    },
  ],
};

test('baseline prompt receives case observations but no gold answer', async () => {
  const input = baselineCaseInput(
    'policy',
    policyDataset,
    policyDataset.cases[0],
  );
  assert.equal(JSON.stringify(input).includes('gold'), false);
  assert.deepEqual(input.savedCatalog, []);
  let sent;
  const result = await runBaselineDataset({
    kind: 'policy',
    dataset: policyDataset,
    apiKey: 'test-secret',
    model: 'test-model',
    fetcher: async (url, init) => {
      sent = { url, init };
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({
                  action: 'no_results',
                  itemIds: [],
                  warnings: [],
                  routeClaims: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 8 },
        }),
        { status: 200 },
      );
    },
  });
  assert.equal(sent.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(sent.init.headers.Authorization, 'Bearer test-secret');
  assert.equal(sent.init.body.includes('"gold"'), false);
  assert.equal(result.score.casePassRate, 1);
  assert.equal(result.attempts[0].usage.prompt_tokens, 10);
  assert.equal(JSON.stringify(result).includes('test-secret'), false);
});

test('provider failure is recorded as a missing prediction, not an invented answer', async () => {
  const result = await runBaselineDataset({
    kind: 'policy',
    dataset: policyDataset,
    apiKey: 'test-secret',
    model: 'test-model',
    fetcher: async () => new Response('', { status: 503 }),
  });
  assert.equal(result.attempts[0].error, 'provider_http_503');
  assert.deepEqual(result.predictionFile.predictions, []);
  assert.equal(result.score.completedPredictions, 0);
  assert.equal(result.score.casePassRate, 0);
});

test('intent and decision inputs exclude gold and unrelated saved catalog items', () => {
  const intent = {
    originOptions: [{ id: 'area:ginza', kind: 'area', names: ['銀座'] }],
  };
  assert.deepEqual(
    baselineCaseInput('intent', intent, {
      input: { message: '銀座で寿司' },
      gold: { action: 'recommend' },
    }),
    { userMessage: '銀座で寿司', originOptions: intent.originOptions },
  );
  const dialogue = baselineCaseInput('dialogue', intent, {
    input: { messages: ['近く', 'どこから？', '銀座駅'] },
    gold: { action: 'recommend' },
  });
  assert.equal(JSON.stringify(dialogue).includes('gold'), false);
  assert.equal(dialogue.conversation.length, 3);
  const decision = baselineCaseInput(
    'decision',
    { catalog: [{ id: 'saved' }, { id: 'excluded' }] },
    {
      input: {
        intent: { foodTerms: [] },
        origin: { state: 'none' },
        catalogIds: ['saved'],
        routes: [],
        distances: [],
      },
      gold: { topItemIds: ['saved'] },
    },
  );
  assert.deepEqual(decision.savedCatalog, [{ id: 'saved' }]);
  assert.equal(JSON.stringify(decision).includes('gold'), false);
});
