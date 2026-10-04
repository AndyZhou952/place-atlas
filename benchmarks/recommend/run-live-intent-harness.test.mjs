import assert from 'node:assert/strict';
import test from 'node:test';

import { runLiveIntentDataset } from './run-live-intent-harness.mjs';

const dataset = {
  schemaVersion: 1,
  datasetId: 'harness-test',
  originOptions: [],
  cases: [
    {
      caseId: 'food',
      input: { message: 'ラーメン食べたい' },
      gold: {
        action: 'recommend',
        originId: null,
        foodTerms: ['ramen'],
        excludedFoodTerms: [],
        travelMode: 'none',
        maxMinutes: null,
        visited: 'prefer_unvisited',
      },
    },
  ],
};

const settings = {
  agentApiKey: 'test-private-key',
  agentBaseUrl: 'https://api.deepseek.com',
  agentModel: 'test-model',
};

test('live harness sends no gold and scores the production normalization', async () => {
  let body;
  const result = await runLiveIntentDataset({
    dataset,
    kind: 'intent',
    settings,
    fetcher: async (_url, init) => {
      body = init.body;
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                action: 'recommend',
                originId: null,
                foodTerms: ['ラーメン'],
                excludedFoodTerms: [],
                travelMode: 'none',
                maxMinutes: null,
                visited: 'any',
              }),
            },
          },
        ],
        usage: { total_tokens: 23 },
      });
    },
  });
  assert.equal(body.includes('"gold"'), false);
  assert.equal(result.score.casePassRate, 1);
  assert.equal(result.attempts[0].usage.total_tokens, 23);
  assert.equal(JSON.stringify(result).includes('test-private-key'), false);
});

test('model outage leaves a missing prediction and fails the case', async () => {
  const result = await runLiveIntentDataset({
    dataset,
    kind: 'intent',
    settings,
    fetcher: async () => new Response('', { status: 503 }),
  });
  assert.equal(result.score.completedPredictions, 0);
  assert.equal(result.score.casePassRate, 0);
});
