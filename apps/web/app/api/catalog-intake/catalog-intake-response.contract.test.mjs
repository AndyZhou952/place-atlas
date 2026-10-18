import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogIntakeResponse } from './catalog-intake-response.ts';

const serverConversationId = '000102030405060708090a0b0c0d0e0f';

test('catalog intake HTTP derives the owner scope and 128-bit Web conversation on the server', async () => {
  const calls = [];
  const request = new Request(
    'https://atlas.test/api/catalog-intake/discover',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ownerId: 'attacker',
        input: { query: '鮨青空', requestToken: 'request-1' },
      }),
    },
  );
  const response = await catalogIntakeResponse({
    application: {
      async execute(operation, context) {
        calls.push({ operation, context });
        return { ok: true, value: { status: 'candidates_ready' } };
      },
    },
    request,
    operation: 'catalog.intake.discover',
    serverConversationId,
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(
    response.headers.get('x-atlas-web-conversation-id'),
    '000102030405060708090a0b0c0d0e0f',
  );
  assert.deepEqual(calls, [
    {
      operation: {
        key: 'catalog.intake.discover',
        input: { query: '鮨青空', requestToken: 'request-1' },
      },
      context: {
        invocation: {
          ownerId: 'owner',
          channel: 'web',
          conversationId: '000102030405060708090a0b0c0d0e0f',
        },
      },
    },
  ]);
});

test('discover replaces a forged valid conversation while retaining a server-issued retry', async () => {
  const observed = [];
  for (const suppliedConversation of [
    'ffffffffffffffffffffffffffffffff',
    serverConversationId,
  ]) {
    const response = await catalogIntakeResponse({
      application: {
        async execute(_operation, context) {
          observed.push(context.invocation.conversationId);
          return { ok: true, value: { status: 'candidates_ready' } };
        },
      },
      request: new Request('https://atlas.test/api/catalog-intake/discover', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-atlas-web-conversation-id': suppliedConversation,
        },
        body: JSON.stringify({ input: { query: '鮨青空' } }),
      }),
      operation: 'catalog.intake.discover',
      serverConversationId,
    });

    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('x-atlas-web-conversation-id'),
      serverConversationId,
    );
  }
  assert.deepEqual(observed, [serverConversationId, serverConversationId]);
});

test('non-discover intake requires a valid server-issued conversation before Application work', async () => {
  let calls = 0;
  const response = await catalogIntakeResponse({
    application: {
      async execute() {
        calls += 1;
        return { ok: true, value: {} };
      },
    },
    request: new Request('https://atlas.test/api/catalog-intake/select', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-atlas-web-conversation-id': 'not-valid',
      },
      body: JSON.stringify({ input: {} }),
    }),
    operation: 'catalog.intake.select',
    serverConversationId,
  });

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), {
    code: 'invalid_input',
    message: 'The Web catalog intake conversation is invalid.',
  });
});

test('catalog intake HTTP maps closed Add errors without leaking internal fields', async () => {
  const response = await catalogIntakeResponse({
    application: {
      async execute() {
        return {
          ok: false,
          error: Object.assign(
            {
              code: 'expired',
              message: 'Start a new preview.',
              retryable: false,
              secret: 'never expose',
            },
            { kind: 'conflict' },
          ),
        };
      },
    },
    request: new Request('https://atlas.test/api/catalog-intake/select', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-atlas-web-conversation-id': '000102030405060708090a0b0c0d0e0f',
      },
      body: JSON.stringify({ input: {} }),
    }),
    operation: 'catalog.intake.select',
    serverConversationId,
  });

  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), {
    code: 'expired',
    message: 'Start a new preview.',
    retryable: false,
  });
});

test('non-discover intake rejects a forged but well-formed conversation', async () => {
  let calls = 0;
  const response = await catalogIntakeResponse({
    application: {
      async execute() {
        calls += 1;
        return { ok: true, value: {} };
      },
    },
    request: new Request('https://atlas.test/api/catalog-intake/select', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-atlas-web-conversation-id': 'ffffffffffffffffffffffffffffffff',
      },
      body: JSON.stringify({ input: {} }),
    }),
    operation: 'catalog.intake.select',
    serverConversationId,
  });

  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), {
    code: 'invalid_input',
    message: 'The Web catalog intake conversation is invalid.',
  });
});

for (const stage of ['construction', 'execution']) {
  test(`Add HTTP contains ${stage} exceptions with a safe diagnostic reference`, async () => {
    const logs = [];
    const original = console.error;
    console.error = (...values) => logs.push(values);
    try {
      const response = await catalogIntakeResponse({
        getApplication() {
          if (stage === 'construction') throw new Error('credential=private');
          return {
            async execute() {
              throw new Error('credential=private');
            },
          };
        },
        request: new Request('https://atlas.test/api/catalog-intake/discover', {
          method: 'POST',
          body: JSON.stringify({ input: { query: 'private-query' } }),
        }),
        operation: 'catalog.intake.discover',
        serverConversationId,
      });
      assert.equal(response.status, 500);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(
        response.headers.get('x-atlas-web-conversation-id'),
        serverConversationId,
      );
      const reference = response.headers.get('x-atlas-request-id');
      assert.match(reference, /^[a-f0-9-]{36}$/);
      const body = await response.json();
      assert.equal(body.code, 'unexpected_failure');
      assert.equal(body.retryable, true);
      assert.deepEqual(logs, [
        ['catalog_intake_request_failed', 'catalog.intake.discover', reference],
      ]);
      assert.doesNotMatch(JSON.stringify({ logs, body }), /credential|private/);
    } finally {
      console.error = original;
    }
  });
}
