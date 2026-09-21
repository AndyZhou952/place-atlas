import assert from 'node:assert/strict';
import test from 'node:test';

import { createJpmapRouterClient } from '../../../../features/004-openclaw-atlas-poc/deployment/openclaw-poc/src/jpmap-client.mjs';

import { createAtlasApplication } from '../../product/application/atlas-application.ts';
import { createNearbyRecommendationOperationGroup } from '../../product/application/decision/agent-nearby-operation.ts';
import { signAgentHttpRequest } from '../../product/application/conversation/agent-request-signing.ts';
import {
  createIsolatedReadonlyAgentHttpHandler as createServiceHandler,
  createIsolatedReadonlyNearbyComposition,
} from './isolated-readonly-agent-service.ts';

const secret = 'local-contract-secret';
const owner = {
  actorId: 'wechat-owner',
  channel: 'openclaw-weixin',
  conversationId: 'owner-dm',
  conversationType: 'direct',
};

function createFakeD1() {
  const nonces = new Map();
  const receipts = new Map();
  const audits = [];
  let fixtureReads = 0;

  return {
    value: {
      prepare(sql) {
        return {
          bind(...bindings) {
            return {
              async run() {
                if (/INSERT INTO agent_gateway_nonces/u.test(sql)) {
                  const [projectId, keyId, nonce, retainUntilMs, nowMs] =
                    bindings;
                  const key = `${projectId}:${keyId}:${nonce}`;
                  const existing = nonces.get(key);
                  if (existing !== undefined && existing > nowMs) {
                    return { meta: { changes: 0 } };
                  }
                  nonces.set(key, retainUntilMs);
                  return { meta: { changes: 1 } };
                }
                if (/INSERT INTO agent_gateway_receipts/u.test(sql)) {
                  const [projectId, mutationId, payloadDigest, resultJson] =
                    bindings;
                  const key = `${projectId}:${mutationId}`;
                  if (receipts.has(key)) {
                    return { meta: { changes: 0 } };
                  }
                  receipts.set(key, {
                    mutation_id: mutationId,
                    payload_digest: payloadDigest,
                    result_json: resultJson,
                  });
                  return { meta: { changes: 1 } };
                }
                if (/UPDATE agent_gateway_receipts/u.test(sql)) {
                  const [
                    resultJson,
                    projectId,
                    mutationId,
                    payloadDigest,
                    claimJson,
                  ] = bindings;
                  const key = `${projectId}:${mutationId}`;
                  const existing = receipts.get(key);
                  if (
                    !existing ||
                    existing.payload_digest !== payloadDigest ||
                    existing.result_json !== claimJson
                  ) {
                    return { meta: { changes: 0 } };
                  }
                  receipts.set(key, { ...existing, result_json: resultJson });
                  return { meta: { changes: 1 } };
                }
                if (/DELETE FROM agent_gateway_receipts/u.test(sql)) {
                  const [projectId, mutationId, payloadDigest, claimJson] =
                    bindings;
                  const key = `${projectId}:${mutationId}`;
                  const existing = receipts.get(key);
                  if (
                    !existing ||
                    existing.payload_digest !== payloadDigest ||
                    existing.result_json !== claimJson
                  ) {
                    return { meta: { changes: 0 } };
                  }
                  receipts.delete(key);
                  return { meta: { changes: 1 } };
                }
                if (/INSERT INTO agent_gateway_audit/u.test(sql)) {
                  audits.push(bindings);
                  return { meta: { changes: 1 } };
                }
                assert.fail(`Unexpected D1 mutation: ${sql}`);
              },
              async first() {
                if (/FROM agent_gateway_receipts/u.test(sql)) {
                  return receipts.get(`${bindings[0]}:${bindings[1]}`) ?? null;
                }
                assert.fail(`Unexpected D1 first query: ${sql}`);
              },
              async all() {
                if (/FROM agent_nearby_fixtures/u.test(sql)) {
                  fixtureReads += 1;
                  return {
                    results: [
                      {
                        resolved_location: '东京都中央区银座',
                        item_id: 'fixture-sushi-1',
                        name: 'Fixture Sushi 银座',
                        area: '银座',
                        address: '东京都中央区银座 1-2-3',
                        walking_minutes: 8,
                        visited: 0,
                        reason: '步行可达，而且你还没去过',
                        map_deep_link:
                          'https://fixture.invalid/items/fixture-sushi-1',
                      },
                    ],
                  };
                }
                assert.fail(`Unexpected D1 all query: ${sql}`);
              },
            };
          },
        };
      },
    },
    audits,
    get fixtureReads() {
      return fixtureReads;
    },
  };
}

function bindings(database, overrides = {}) {
  return {
    DB: database,
    MEDIA: {},
    ATLAS_DATASET: 'fixture',
    ATLAS_DEPLOYMENT_ENV: 'agent-poc-readonly',
    AGENT_JPMAP_KEY_ID: 'jpmap-poc-v1',
    AGENT_JPMAP_HMAC_SECRET: secret,
    AGENT_OWNER_ACTOR_ID: owner.actorId,
    AGENT_OWNER_CONVERSATION_ID: owner.conversationId,
    ...overrides,
  };
}

function body(overrides = {}) {
  return {
    version: '1',
    projectId: 'jpmap',
    tool: 'jpmap_nearby',
    mutationId: 'wechat-event-1',
    actor: owner,
    input: { locationHint: '银座' },
    ...overrides,
  };
}

function createHandler(agentBindings, clock) {
  const composition = createIsolatedReadonlyNearbyComposition(agentBindings.DB);
  const application = createAtlasApplication(
    createNearbyRecommendationOperationGroup({
      ...composition.agentNearby,
      catalog: composition.catalogRead,
    }),
  );
  return createServiceHandler(agentBindings, application, clock);
}
test('the OpenClaw client envelope is accepted by the isolated Worker boundary', async () => {
  const database = createFakeD1();
  const nowMs = Date.parse('2026-09-13T12:00:00.000Z');
  const handler = createHandler(bindings(database.value), {
    nowMs: () => nowMs,
  });
  const uuids = ['cross-boundary-event', 'cross-boundary-nonce'];
  const client = createJpmapRouterClient({
    env: {
      JPMAP_AGENT_ENDPOINT: 'https://poc.example/api/agent/v1/tools',
      JPMAP_AGENT_KEY_ID: 'jpmap-poc-v1',
      JPMAP_AGENT_HMAC_SECRET: secret,
      JPMAP_OWNER_ACTOR_ID: owner.actorId,
      JPMAP_OWNER_CONVERSATION_ID: owner.conversationId,
    },
    commandContext: {
      senderId: owner.actorId,
      channel: owner.channel,
      channelId: owner.channel,
      isAuthorizedSender: true,
      from: owner.conversationId,
      to: owner.conversationId,
    },
    nowMs: () => nowMs,
    randomUUID: () => uuids.shift(),
    fetchImpl: async (url, init) => handler(new Request(url, init)),
  });

  const reply = await client({
    command: 'nearby 银座',
    commandName: 'jpmap',
    skillName: 'jpmap',
  });

  assert.match(reply, /Fixture Sushi 银座/u);
  assert.equal(database.fixtureReads, 1);
  assert.equal(database.audits[0][3], 'openclaw-weixin');
});

test('a signed Agent HTTP request reaches only the isolated D1 nearby fixture', async () => {
  const database = createFakeD1();
  const handler = createHandler(bindings(database.value), {
    nowMs: () => Date.parse('2026-09-13T12:00:00.000Z'),
  });
  const request = await signAgentHttpRequest({
    url: 'https://poc.example/api/agent/v1/tools',
    method: 'POST',
    body: body(),
    keyId: 'jpmap-poc-v1',
    secret,
    timestamp: '1789300800',
    nonce: 'nonce-1',
  });

  const response = await handler(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.receipt.result.operation, 'nearby');
  assert.match(payload.receipt.result.replyText, /Fixture Sushi 银座/u);
  assert.equal(database.fixtureReads, 1);
  assert.equal(database.audits.length, 1);
  assert.deepEqual(database.audits[0].slice(0, 8), [
    'jpmap',
    'jpmap-poc-v1',
    'wechat-owner',
    'openclaw-weixin',
    'owner-dm',
    'agent.nearby',
    'wechat-event-1',
    'success',
  ]);
  assert.doesNotMatch(
    JSON.stringify(database.audits),
    /local-contract-secret|银座/u,
  );
});

test('D1 unique claims serialize concurrent nonces and replay the committed receipt', async () => {
  const database = createFakeD1();
  const handler = createHandler(bindings(database.value), {
    nowMs: () => Date.parse('2026-09-13T12:00:00.000Z'),
  });
  const first = await signAgentHttpRequest({
    url: 'https://poc.example/api/agent/v1/tools',
    method: 'POST',
    body: body({ mutationId: 'd1-concurrent-event' }),
    keyId: 'jpmap-poc-v1',
    secret,
    timestamp: '1789300800',
    nonce: 'd1-concurrent-nonce-1',
  });
  const second = await signAgentHttpRequest({
    url: 'https://poc.example/api/agent/v1/tools',
    method: 'POST',
    body: body({ mutationId: 'd1-concurrent-event' }),
    keyId: 'jpmap-poc-v1',
    secret,
    timestamp: '1789300800',
    nonce: 'd1-concurrent-nonce-2',
  });

  const responses = await Promise.all([handler(first), handler(second)]);
  const payloads = await Promise.all(
    responses.map((response) => response.json()),
  );
  const replay = await signAgentHttpRequest({
    url: 'https://poc.example/api/agent/v1/tools',
    method: 'POST',
    body: body({ mutationId: 'd1-concurrent-event' }),
    keyId: 'jpmap-poc-v1',
    secret,
    timestamp: '1789300800',
    nonce: 'd1-concurrent-nonce-3',
  });
  const conflict = await signAgentHttpRequest({
    url: 'https://poc.example/api/agent/v1/tools',
    method: 'POST',
    body: body({
      mutationId: 'd1-concurrent-event',
      input: { locationHint: '渋谷' },
    }),
    keyId: 'jpmap-poc-v1',
    secret,
    timestamp: '1789300800',
    nonce: 'd1-concurrent-nonce-4',
  });
  const replayResponse = await handler(replay);
  const conflictResponse = await handler(conflict);
  const replayPayload = await replayResponse.json();
  const conflictPayload = await conflictResponse.json();

  assert.equal(replayResponse.status, 200);
  assert.equal(replayPayload.receipt.replayed, true);
  assert.equal(
    replayPayload.receipt.payloadDigest,
    payloads[0].receipt.payloadDigest,
  );
  assert.equal(conflictResponse.status, 409);
  assert.equal(conflictPayload.error.kind, 'conflict');

  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  );
  assert.equal(database.fixtureReads, 1);
  assert.equal(
    payloads[0].receipt.payloadDigest,
    payloads[1].receipt.payloadDigest,
  );
  assert.deepEqual(
    payloads.map((payload) => payload.receipt.replayed),
    [false, true],
  );
  assert.deepEqual(
    database.audits.map((audit) => [audit[7], audit[8]]),
    [
      ['success', 0],
      ['success', 1],
      ['success', 1],
      ['conflict', 0],
    ],
  );
});

test('a non-fixture environment fails closed before D1 or an Agent tool is reached', async () => {
  const database = createFakeD1();
  const handler = createHandler(
    bindings(database.value, { ATLAS_DATASET: 'production' }),
  );
  const request = await signAgentHttpRequest({
    url: 'https://poc.example/api/agent/v1/tools',
    method: 'POST',
    body: body(),
    keyId: 'jpmap-poc-v1',
    secret,
    timestamp: `${Math.floor(Date.now() / 1000)}`,
    nonce: 'nonce-unsafe-env',
  });

  const response = await handler(request);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'The isolated Japan Atlas PoC is unavailable.',
    },
  });
  assert.equal(database.fixtureReads, 0);
  assert.deepEqual(database.audits, []);
});

test('hidden write or destructive tools are denied without reading fixture data', async () => {
  const database = createFakeD1();
  const handler = createHandler(bindings(database.value), {
    nowMs: () => Date.parse('2026-09-13T12:00:00.000Z'),
  });
  const request = await signAgentHttpRequest({
    url: 'https://poc.example/api/agent/v1/tools',
    method: 'POST',
    body: body({ tool: 'catalog.delete' }),
    keyId: 'jpmap-poc-v1',
    secret,
    timestamp: '1789300800',
    nonce: 'nonce-hidden-tool',
  });

  const response = await handler(request);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.kind, 'forbidden');
  assert.equal(database.fixtureReads, 0);
  assert.equal(database.audits.length, 1);
});
