import assert from 'node:assert/strict';
import test from 'node:test';

import { createHttpResearchRelayRpc } from './http-research-relay-rpc.ts';
import { createResearchRelayHttpEntry } from './research-relay-http-entry.ts';

const secret = 'r'.repeat(32);

test('fixed HTTPS RPC sends one bounded bearer-authenticated request without redirects', async () => {
  const calls = [];
  const rpc = createHttpResearchRelayRpc({
    endpoint: 'https://research.example/v1/research',
    bearerSecret: secret,
    async fetch(url, init) {
      calls.push({ url, init });
      return new Response(JSON.stringify({ status: 'ok', result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const allowance = { signed: true };
  const payload = { phase: 'initial', query: 'fixture' };
  const result = await rpc.invoke({
    allowance,
    payload,
    signal: new AbortController().signal,
    deadlineAtMs: Date.now() + 5_000,
    maxAttempts: 1,
    redirect: 'error',
  });
  assert.deepEqual(result, { status: 'ok', result: {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://research.example/v1/research');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${secret}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { allowance, payload });

  for (const endpoint of [
    'http://research.example/v1/research',
    'https://research.example/other',
    'https://research.example/v1/research?debug=1',
  ]) {
    assert.throws(
      () => createHttpResearchRelayRpc({ endpoint, bearerSecret: secret }),
      /configuration is invalid/u,
    );
  }
});

test('Relay HTTP entry rejects before cleanup or egress and exposes only closed errors', async () => {
  let cleanupCalls = 0;
  let relayCalls = 0;
  const entry = createResearchRelayHttpEntry({
    bearerSecret: secret,
    async cleanup() {
      cleanupCalls += 1;
    },
    relay: {
      async handle(allowance, payload) {
        relayCalls += 1;
        return { status: 'ok', result: { allowance, payload } };
      },
    },
  });
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
  for (const request of [
    {
      method: 'GET',
      path: '/v1/research',
      authorization: `Bearer ${secret}`,
      contentType: 'application/json',
      body: encode({ allowance: {}, payload: {} }),
    },
    {
      method: 'POST',
      path: '/v1/research',
      authorization: 'Bearer wrong',
      contentType: 'application/json',
      body: encode({ allowance: {}, payload: {} }),
    },
    {
      method: 'POST',
      path: '/v1/research',
      authorization: `Bearer ${secret}`,
      contentType: 'text/plain',
      body: encode({ allowance: {}, payload: {} }),
    },
    {
      method: 'POST',
      path: '/v1/research',
      authorization: `Bearer ${secret}`,
      contentType: 'application/json',
      body: encode({ allowance: {}, payload: {}, extra: true }),
    },
  ]) {
    const result = await entry.handle(request);
    assert.notEqual(result.status, 200);
  }
  assert.equal(cleanupCalls, 0);
  assert.equal(relayCalls, 0);

  const result = await entry.handle({
    method: 'POST',
    path: '/v1/research',
    authorization: `Bearer ${secret}`,
    contentType: 'application/json',
    body: encode({
      allowance: { signed: true },
      payload: { phase: 'initial' },
    }),
  });
  assert.equal(result.status, 200);
  assert.equal(cleanupCalls, 1);
  assert.equal(relayCalls, 1);
});
