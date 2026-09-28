import assert from 'node:assert/strict';
import test from 'node:test';

import { addAgentIntakeResponse } from './add-agent-intake-response.ts';

const token = 'abcdefghijklmnopABCDEFGHIJKLMNOP01234567';
const secrets = {
  ATLAS_ADD_AGENT_TOKEN: token,
  ATLAS_OWNER_SESSION_SECRET:
    'test-owner-session-secret-with-at-least-32-bytes',
};

function request(operation, input, options = {}) {
  return new Request('https://atlas.test/api/agent/catalog-intake', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.token ?? token}`,
      'content-type': 'application/json',
      ...(options.conversation
        ? { 'x-atlas-agent-conversation-id': options.conversation }
        : {}),
      ...(options.cookie ? { cookie: 'fake=owner' } : {}),
    },
    body: JSON.stringify({ operation, input }),
  });
}

test('external Agent receives a separate server-derived scope and must echo its conversation', async () => {
  const calls = [];
  const getApplication = () => ({
    async execute(operation, context) {
      calls.push({ operation, context });
      return { ok: true, value: { status: 'candidates_ready' } };
    },
  });
  const discover = await addAgentIntakeResponse({
    request: request('catalog.intake.discover', {
      query: 'Verve Coffee 六本木',
      requestToken: 'stable-1',
    }),
    getApplication,
    secrets,
  });
  assert.equal(discover.status, 200);
  const conversation = discover.headers.get('x-atlas-agent-conversation-id');
  assert.match(conversation, /^[a-f0-9]{32}$/u);
  assert.equal(discover.headers.get('x-atlas-web-conversation-id'), null);
  assert.equal(discover.headers.get('cache-control'), 'no-store');

  const select = await addAgentIntakeResponse({
    request: request(
      'catalog.intake.select',
      { sessionId: 'session-1', expectedSessionVersion: 1, ordinal: 1 },
      { conversation },
    ),
    getApplication,
    secrets,
  });
  assert.equal(select.status, 200);
  assert.deepEqual(
    calls.map(({ operation, context }) => [
      operation.key,
      context.invocation.ownerId,
      context.invocation.channel,
      context.invocation.conversationId,
    ]),
    [
      ['catalog.intake.discover', 'owner', 'external_agent', conversation],
      ['catalog.intake.select', 'owner', 'external_agent', conversation],
    ],
  );
});

test('missing configuration, wrong token, cookie and malformed operations reject before application work', async () => {
  let applications = 0;
  const getApplication = () => {
    applications += 1;
    return {
      async execute() {
        return { ok: true, value: {} };
      },
    };
  };
  const cases = [
    {
      request: request(
        'catalog.intake.discover',
        {},
        { token: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      ),
      secrets,
      status: 401,
    },
    {
      request: request('catalog.intake.discover', {}, { cookie: true }),
      secrets,
      status: 401,
    },
    {
      request: request('catalog.intake.discover', {}),
      secrets: {
        ATLAS_OWNER_SESSION_SECRET: secrets.ATLAS_OWNER_SESSION_SECRET,
      },
      status: 503,
    },
    {
      request: request('catalog.items.delete', {}),
      secrets,
      status: 400,
    },
    {
      request: request('catalog.intake.select', {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        ownerFields: { title: 'Unverified Agent claim' },
      }),
      secrets,
      status: 400,
    },
    {
      request: request('catalog.intake.select', {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        tabelog: { score: 5, url: 'https://example.test' },
      }),
      secrets,
      status: 400,
    },
  ];
  for (const candidate of cases) {
    const response = await addAgentIntakeResponse({
      request: candidate.request,
      getApplication,
      secrets: candidate.secrets,
    });
    assert.equal(response.status, candidate.status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(applications, 0);
});

test('external Agent request bodies are bounded before application work', async () => {
  let applications = 0;
  const response = await addAgentIntakeResponse({
    request: request('catalog.intake.discover', {
      query: 'X'.repeat(70_000),
      requestToken: 'large',
    }),
    getApplication: () => {
      applications += 1;
      return {};
    },
    secrets,
  });
  assert.equal(response.status, 413);
  assert.equal(applications, 0);
});

test('confirmation cannot cross a forged conversation and preserves the application result', async () => {
  let calls = 0;
  let applications = 0;
  const getApplication = () => {
    applications += 1;
    return {
      async execute(operation) {
        calls += 1;
        assert.equal(operation.key, 'catalog.intake.confirm');
        return {
          ok: true,
          value: { status: 'failed_no_write', reason: 'validation' },
        };
      },
    };
  };
  const denied = await addAgentIntakeResponse({
    request: request(
      'catalog.intake.confirm',
      { sessionId: 'session-1', expectedPreviewVersion: 1 },
      { conversation: 'ffffffffffffffffffffffffffffffff' },
    ),
    getApplication,
    secrets,
  });
  assert.equal(denied.status, 400);
  assert.equal(calls, 0);
  assert.equal(applications, 0);
  const discover = await addAgentIntakeResponse({
    request: request('catalog.intake.discover', {
      query: 'Verve',
      requestToken: 'r-1',
    }),
    getApplication: () => ({
      async execute() {
        return { ok: true, value: { status: 'candidates_ready' } };
      },
    }),
    secrets,
  });
  const accepted = await addAgentIntakeResponse({
    request: request(
      'catalog.intake.confirm',
      { sessionId: 'session-1', expectedPreviewVersion: 1 },
      { conversation: discover.headers.get('x-atlas-agent-conversation-id') },
    ),
    getApplication,
    secrets,
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), {
    status: 'failed_no_write',
    reason: 'validation',
  });
  assert.equal(calls, 1);
  assert.equal(applications, 1);
});
