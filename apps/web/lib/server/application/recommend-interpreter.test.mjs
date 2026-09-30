import assert from 'node:assert/strict';
import test from 'node:test';

import { createRecommendInterpreter } from './recommend-interpreter.ts';

test('Recommend interpreter sends bounded owner request without gold labels', async () => {
  let sent;
  const interpreter = createRecommendInterpreter(
    {
      agentApiKey: 'test-private-key',
      agentBaseUrl: 'https://api.deepseek.com',
      agentModel: 'deepseek-flash',
    },
    async (url, init) => {
      sent = { url, init };
      return Response.json({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                action: 'clarify',
                originId: null,
                foodTerms: ['ramen'],
                excludedFoodTerms: [],
                travelMode: 'walk',
                maxMinutes: 10,
                visited: 'prefer_unvisited',
                clarification: 'origin',
                question: 'Where are you?',
              }),
            },
          },
        ],
      });
    },
  );
  const result = await interpreter.interpret(
    { query: '徒歩10分のラーメン', replies: [] },
    [{ id: 'area:銀座', kind: 'area', names: ['銀座'] }],
  );
  assert.equal(result.action, 'clarify');
  assert.equal(sent.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(sent.init.headers.Authorization, 'Bearer test-private-key');
  assert.equal(sent.init.body.includes('"gold"'), false);
  assert.equal(JSON.stringify(result).includes('test-private-key'), false);
});

test('truncated model answers fail closed', async () => {
  const interpreter = createRecommendInterpreter(
    {
      agentApiKey: 'test-private-key',
      agentBaseUrl: 'https://api.deepseek.com',
      agentModel: 'deepseek-flash',
    },
    async () =>
      Response.json({
        choices: [
          {
            finish_reason: 'length',
            message: { content: '{"action":"recommend"}' },
          },
        ],
      }),
  );
  await assert.rejects(
    interpreter.interpret({ query: 'sushi', replies: [] }, []),
    /incomplete/u,
  );
});
