import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import {
  createAgentToolCatalog,
  createProjectCommandRouter,
} from './project-command-router.ts';
import { createNearbyRecommendationOperationGroup } from '../decision/agent-nearby-operation.ts';
import { createAgentNearbyTestDependencies } from './agent-nearby-test-fixture.mjs';
import {
  createAgentServiceGateway,
  InMemoryAgentGatewayState,
} from './agent-service-gateway.ts';
import {
  canonicalAgentRequestBytes,
  agentSignatureHeaders,
  signAgentHttpRequest,
  verifyAgentHmac,
} from './agent-request-signing.ts';
import { createAgentHttpHandler } from '../../../adapters/agent/agent-http-mapping.ts';

const secret = 'fixture-secret-never-log';
const owner = {
  actorId: 'wechat-owner',
  channel: 'wechat',
  conversationId: 'owner-dm',
  conversationType: 'direct',
};

function nearbyFixture(locationHint) {
  return {
    requestedLocation: locationHint,
    resolvedLocation: '东京都中央区银座',
    recommendations: [
      {
        itemId: 'sushi-1',
        name: '鲜鱼 銀座本店',
        area: '银座',
        address: '东京都中央区银座 1-2-3',
        walkingMinutes: 8,
        visited: false,
        reason: '步行可达，而且你还没去过',
        mapDeepLink: 'https://atlas.example/items/sushi-1',
      },
    ],
  };
}

function createHarness(options = {}) {
  const providerCalls = [];
  const audits = [];
  const application = createAtlasApplication(
    createNearbyRecommendationOperationGroup(
      createAgentNearbyTestDependencies({
        async recommend(input) {
          providerCalls.push(input);
          if (options.provider) {
            return options.provider(input);
          }
          return { ok: true, value: nearbyFixture(input.locationHint) };
        },
      }),
    ),
  );
  const gateway = createAgentServiceGateway({
    router: createProjectCommandRouter(application),
    toolCatalog: createAgentToolCatalog(),
    keys: {
      async find(keyId) {
        if (keyId !== 'key-1') return undefined;
        return {
          keyId,
          projectId: 'jpmap',
          secret,
          active: true,
          owner,
          scopes: ['atlas:nearby:read'],
          ...options.keyOverrides,
        };
      },
    },
    state: new InMemoryAgentGatewayState(),
    audit: {
      async record(event) {
        audits.push(event);
      },
    },
    clock: {
      nowMs: () => options.nowMs ?? Date.parse('2026-09-13T12:00:00.000Z'),
    },
  });
  return {
    providerCalls,
    audits,
    gateway,
    handle: createAgentHttpHandler(gateway),
  };
}

function requestBody(overrides = {}) {
  return {
    version: '1',
    projectId: 'jpmap',
    tool: 'jpmap_nearby',
    mutationId: 'wechat-message-1',
    actor: owner,
    input: { locationHint: '银座' },
    ...overrides,
  };
}

test('canonical bytes and signed HTTP request cross the read-only gateway into AtlasApplication', async () => {
  assert.equal(
    canonicalAgentRequestBytes({
      method: 'post',
      url: 'https://atlas.test/api/agent/v1/tools?z=2&a=hello%20world&a=1',
      bodyDigest: '0'.repeat(64),
      timestamp: '1789300800',
      nonce: 'nonce-1',
      keyId: 'key-1',
    }),
    `POST\n/api/agent/v1/tools?a=1&a=hello+world&z=2\n${'0'.repeat(64)}\n1789300800\nnonce-1\nkey-1`,
  );

  const harness = createHarness();
  const request = await signAgentHttpRequest({
    url: 'https://atlas.test/api/agent/v1/tools',
    method: 'POST',
    body: requestBody(),
    keyId: 'key-1',
    secret,
    timestamp: '1789300800',
    nonce: 'nonce-1',
  });
  const response = await harness.handle(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.receipt.mutationId, 'wechat-message-1');
  assert.match(payload.receipt.payloadDigest, /^[a-f0-9]{64}$/u);
  assert.equal(payload.receipt.replayed, false);
  assert.equal(payload.receipt.result.projectId, 'jpmap');
  assert.equal(payload.receipt.result.operation, 'nearby');
  assert.match(payload.receipt.result.replyText, /Japan Atlas｜附近推荐/u);
  assert.deepEqual(harness.providerCalls, [{ locationHint: '银座' }]);
  assert.deepEqual(harness.audits, [
    {
      projectId: 'jpmap',
      keyId: 'key-1',
      actorId: 'wechat-owner',
      channel: 'wechat',
      conversationId: 'owner-dm',
      operation: 'agent.nearby',
      mutationId: 'wechat-message-1',
      resultKind: 'success',
      replayed: false,
      durationMs: 0,
    },
  ]);
});

test('transport replay is rejected while a new nonce replays the same mutation receipt', async () => {
  const harness = createHarness();
  const first = await signAgentHttpRequest({
    url: 'https://atlas.test/api/agent/v1/tools',
    method: 'POST',
    body: requestBody(),
    keyId: 'key-1',
    secret,
    timestamp: '1789300800',
    nonce: 'nonce-replay-1',
  });
  const sameNonce = first.clone();
  const retry = await signAgentHttpRequest({
    url: 'https://atlas.test/api/agent/v1/tools',
    method: 'POST',
    body: requestBody(),
    keyId: 'key-1',
    secret,
    timestamp: '1789300800',
    nonce: 'nonce-replay-2',
  });
  const conflicting = await signAgentHttpRequest({
    url: 'https://atlas.test/api/agent/v1/tools',
    method: 'POST',
    body: requestBody({ input: { locationHint: '渋谷' } }),
    keyId: 'key-1',
    secret,
    timestamp: '1789300800',
    nonce: 'nonce-replay-3',
  });

  const firstResponse = await harness.handle(first);
  const sameNonceResponse = await harness.handle(sameNonce);
  const retryResponse = await harness.handle(retry);
  const conflictResponse = await harness.handle(conflicting);
  const [firstPayload, sameNoncePayload, retryPayload, conflictPayload] =
    await Promise.all([
      firstResponse.json(),
      sameNonceResponse.json(),
      retryResponse.json(),
      conflictResponse.json(),
    ]);

  assert.equal(firstResponse.status, 200);
  assert.equal(sameNonceResponse.status, 401);
  assert.deepEqual(sameNoncePayload, {
    ok: false,
    error: {
      kind: 'unauthorized',
      message: 'The agent request could not be authenticated.',
    },
  });
  assert.equal(retryResponse.status, 200);
  assert.equal(retryPayload.receipt.replayed, true);
  assert.equal(
    retryPayload.receipt.payloadDigest,
    firstPayload.receipt.payloadDigest,
  );
  assert.equal(conflictResponse.status, 409);
  assert.deepEqual(conflictPayload, {
    ok: false,
    error: {
      kind: 'conflict',
      message: 'The agent request conflicts with an earlier request.',
    },
  });
  assert.deepEqual(harness.providerCalls, [{ locationHint: '银座' }]);
  assert.deepEqual(
    harness.audits.map((event) => [event.resultKind, event.replayed]),
    [
      ['success', false],
      ['unauthorized', false],
      ['success', true],
      ['conflict', false],
    ],
  );
});

test('concurrent retries with distinct nonces execute one mutation and replay one receipt', async () => {
  let releaseProvider;
  let signalProviderEntered;
  const providerRelease = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const providerEntered = new Promise((resolve) => {
    signalProviderEntered = resolve;
  });
  const harness = createHarness({
    provider: async (input) => {
      signalProviderEntered();
      await providerRelease;
      return { ok: true, value: nearbyFixture(input.locationHint) };
    },
  });
  const firstRequest = await signAgentHttpRequest({
    url: 'https://atlas.test/api/agent/v1/tools',
    method: 'POST',
    body: requestBody({ mutationId: 'concurrent-mutation' }),
    keyId: 'key-1',
    secret,
    timestamp: '1789300800',
    nonce: 'concurrent-nonce-1',
  });
  const secondRequest = await signAgentHttpRequest({
    url: 'https://atlas.test/api/agent/v1/tools',
    method: 'POST',
    body: requestBody({ mutationId: 'concurrent-mutation' }),
    keyId: 'key-1',
    secret,
    timestamp: '1789300800',
    nonce: 'concurrent-nonce-2',
  });

  const firstResponsePromise = harness.handle(firstRequest);
  await providerEntered;
  const secondResponsePromise = harness.handle(secondRequest);
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseProvider();

  const responses = await Promise.all([
    firstResponsePromise,
    secondResponsePromise,
  ]);
  const payloads = await Promise.all(
    responses.map((response) => response.json()),
  );

  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  );
  assert.equal(harness.providerCalls.length, 1);
  assert.deepEqual(
    payloads.map((payload) => payload.receipt.replayed),
    [false, true],
  );
  assert.equal(
    payloads[0].receipt.payloadDigest,
    payloads[1].receipt.payloadDigest,
  );
  assert.deepEqual(
    harness.audits.map((event) => [event.resultKind, event.replayed]),
    [
      ['success', false],
      ['success', true],
    ],
  );
});
test('invalid key identifiers are rejected without copying private header text into audit', async () => {
  const invalidKeyIds = ['private\u0007key', `private-${'x'.repeat(129)}`];

  for (const [index, keyId] of invalidKeyIds.entries()) {
    const harness = createHarness();
    const response = await harness.gateway.handle({
      method: 'POST',
      url: 'https://atlas.test/api/agent/v1/tools',
      headers: {
        [agentSignatureHeaders.keyId]: keyId,
        [agentSignatureHeaders.timestamp]: '1789300800',
        [agentSignatureHeaders.nonce]: `invalid-key-${index}`,
        [agentSignatureHeaders.signature]: '0'.repeat(64),
      },
      body: new TextEncoder().encode(JSON.stringify(requestBody())),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      ok: false,
      error: {
        kind: 'unauthorized',
        message: 'The agent request could not be authenticated.',
      },
    });
    assert.equal(harness.providerCalls.length, 0);
    assert.deepEqual(harness.audits, [
      {
        projectId: 'unknown',
        keyId: 'unknown',
        actorId: 'unknown',
        channel: 'unknown',
        conversationId: 'unknown',
        operation: 'unknown',
        mutationId: 'unknown',
        resultKind: 'unauthorized',
        replayed: false,
        durationMs: 0,
      },
    ]);
    assert.doesNotMatch(JSON.stringify(harness.audits), /private/u);
  }
});

test('five-minute authentication boundary and owner/channel/scope allowlist fail closed', async () => {
  const boundaryHarness = createHarness();
  const boundaryRequest = await signAgentHttpRequest({
    url: 'https://atlas.test/api/agent/v1/tools',
    method: 'POST',
    body: requestBody({ mutationId: 'boundary-ok' }),
    keyId: 'key-1',
    secret,
    timestamp: '1789300500',
    nonce: 'boundary-300',
  });
  assert.equal((await boundaryHarness.handle(boundaryRequest)).status, 200);

  const cases = [
    {
      name: '301 seconds old',
      timestamp: '1789300499',
      expectedStatus: 401,
      expectedKind: 'unauthorized',
    },
    {
      name: '301 seconds in the future',
      timestamp: '1789301101',
      expectedStatus: 401,
      expectedKind: 'unauthorized',
    },
    {
      name: 'wrong signature',
      signingSecret: 'wrong-secret',
      expectedStatus: 401,
      expectedKind: 'unauthorized',
    },
    {
      name: 'revoked key',
      keyOverrides: { active: false },
      expectedStatus: 401,
      expectedKind: 'unauthorized',
    },
    {
      name: 'missing scope',
      keyOverrides: { scopes: [] },
      expectedStatus: 403,
      expectedKind: 'forbidden',
    },
    {
      name: 'different owner',
      body: requestBody({
        actor: { ...owner, actorId: 'second-account' },
      }),
      expectedStatus: 403,
      expectedKind: 'forbidden',
    },
    {
      name: 'different conversation',
      body: requestBody({
        actor: { ...owner, conversationId: 'other-dm' },
      }),
      expectedStatus: 403,
      expectedKind: 'forbidden',
    },
    {
      name: 'group conversation',
      body: requestBody({
        actor: {
          ...owner,
          conversationId: 'group-1',
          conversationType: 'group',
        },
      }),
      expectedStatus: 403,
      expectedKind: 'forbidden',
    },
    {
      name: 'hidden destructive operation',
      body: requestBody({ tool: 'catalog.delete_item', input: {} }),
      expectedStatus: 403,
      expectedKind: 'forbidden',
    },
  ];

  for (const [index, scenario] of cases.entries()) {
    const harness = createHarness({ keyOverrides: scenario.keyOverrides });
    const request = await signAgentHttpRequest({
      url: 'https://atlas.test/api/agent/v1/tools',
      method: 'POST',
      body: scenario.body ?? requestBody(),
      keyId: 'key-1',
      secret: scenario.signingSecret ?? secret,
      timestamp: scenario.timestamp ?? '1789300800',
      nonce: `security-${index}`,
    });
    const response = await harness.handle(request);
    const payload = await response.json();

    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.equal(payload.ok, false, scenario.name);
    assert.equal(payload.error.kind, scenario.expectedKind, scenario.name);
    assert.equal(harness.providerCalls.length, 0, scenario.name);
    assert.equal(harness.audits.length, 1, `${scenario.name} audit`);
    assert.equal(
      harness.audits[0].resultKind,
      scenario.expectedKind,
      `${scenario.name} audit kind`,
    );
  }
});

test('HTTP schema and dependency errors are stable, closed, and private', async () => {
  const canonical =
    `POST\n/api/agent/v1/tools?a=1&a=hello+world&z=2\n${'0'.repeat(64)}\n` +
    '1789300800\nnonce-1\nkey-1';
  assert.equal(
    await verifyAgentHmac(
      secret,
      canonical,
      'a9ed83c097cb6b20c9baa7ad5f86ac2bb00d19a1adab67e6375b927a1842242e',
    ),
    true,
  );

  const adapterHarness = createHarness();
  for (const request of [
    new Request('https://atlas.test/api/agent/v1/tools', { method: 'GET' }),
    new Request('https://atlas.test/api/agent/v1/other', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    new Request('https://atlas.test/api/agent/v1/tools', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }),
  ]) {
    const response = await adapterHarness.handle(request);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      ok: false,
      error: {
        kind: 'invalid_input',
        message: 'The agent request is invalid.',
      },
    });
  }

  const invalidBodies = [
    requestBody({ extra: 'not allowed' }),
    requestBody({ input: { locationHint: '银座', extra: 'not allowed' } }),
  ];
  for (const [index, body] of invalidBodies.entries()) {
    const harness = createHarness();
    const request = await signAgentHttpRequest({
      url: 'https://atlas.test/api/agent/v1/tools',
      method: 'POST',
      body,
      keyId: 'key-1',
      secret,
      timestamp: '1789300800',
      nonce: `invalid-${index}`,
    });
    const response = await harness.handle(request);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.kind, 'invalid_input');
    assert.equal(harness.providerCalls.length, 0);
    assert.equal(harness.audits[0].resultKind, 'invalid_input');
  }

  const privateProviderText =
    'upstream secret=should-not-escape raw address 银座';
  const failedHarness = createHarness({
    provider: async () => {
      throw new Error(privateProviderText);
    },
  });
  const failedRequest = await signAgentHttpRequest({
    url: 'https://atlas.test/api/agent/v1/tools',
    method: 'POST',
    body: requestBody({ mutationId: 'provider-failure' }),
    keyId: 'key-1',
    secret,
    timestamp: '1789300800',
    nonce: 'provider-failure',
  });
  const failedResponse = await failedHarness.handle(failedRequest);
  const failedPayload = await failedResponse.json();
  const serializedAudit = JSON.stringify(failedHarness.audits);

  assert.equal(failedResponse.status, 503);
  assert.equal(failedResponse.headers.get('cache-control'), 'no-store');
  assert.deepEqual(failedPayload, {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'Japan Atlas is temporarily unavailable.',
    },
  });
  assert.equal(failedHarness.audits[0].resultKind, 'dependency_failure');
  assert.doesNotMatch(JSON.stringify(failedPayload), /secret|raw address/u);
  assert.doesNotMatch(serializedAudit, /fixture-secret|银座|raw address/u);
});
