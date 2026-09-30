import assert from 'node:assert/strict';
import test from 'node:test';

import { recommendResponse } from './recommend-response.ts';

test('Recommend POST preserves query and replies and prevents caching', async () => {
  let received;
  const response = await recommendResponse(
    new Request('https://atlas.example/api/recommend', {
      method: 'POST',
      body: JSON.stringify({ query: '新宿で焼き鳥', replies: ['新宿駅'] }),
    }),
    {
      async ask(input) {
        received = input;
        return { status: 'no_results', message: 'No saved match.' };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(received, {
    query: '新宿で焼き鳥',
    replies: ['新宿駅'],
  });
  assert.equal((await response.json()).status, 'no_results');
});

test('invalid input is rejected before service work; service failure is retryable', async () => {
  let called = false;
  const invalid = await recommendResponse(
    new Request('https://atlas.example/api/recommend', {
      method: 'POST',
      body: JSON.stringify({ query: '', replies: [] }),
    }),
    {
      async ask() {
        called = true;
        throw new Error('unexpected');
      },
    },
  );
  assert.equal(invalid.status, 400);
  assert.equal(called, false);
  const failed = await recommendResponse(
    new Request('https://atlas.example/api/recommend', {
      method: 'POST',
      body: JSON.stringify({ query: '銀座', replies: [] }),
    }),
    {
      async ask() {
        throw new Error('provider secret must not leak');
      },
    },
  );
  assert.equal(failed.status, 503);
  const body = await failed.text();
  assert.match(body, /"retryable":true/u);
  assert.doesNotMatch(body, /secret/u);
});

test('Recommend POST carries a selected origin candidate and rejects mismatched labels', async () => {
  let received;
  const payload = {
    query: 'Good curry near me',
    replies: ['大久保駅', 'Ōkubo Station, Shinjuku, Tokyo'],
    originChoice: {
      hint: '大久保駅',
      id: 'Ōkubo Station, Shinjuku, Tokyo',
    },
  };
  const service = {
    async ask(input) {
      received = input;
      return { status: 'no_results', message: 'No saved match.' };
    },
  };
  const response = await recommendResponse(
    new Request('https://atlas.example/api/recommend', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    service,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(received, payload);
  received = undefined;
  const invalid = await recommendResponse(
    new Request('https://atlas.example/api/recommend', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        originChoice: { ...payload.originChoice, id: 'Different candidate' },
      }),
    }),
    service,
  );
  assert.equal(invalid.status, 400);
  assert.equal(received, undefined);
});
