import assert from 'node:assert/strict';
import test from 'node:test';

import {
  signResearchResult,
  verifyResearchAllowance,
} from './research-relay-envelope.ts';
import { createResearchRelayWebResearchPort } from './research-relay-web-research-port.ts';

const allowanceSecret = 'allowance-secret-that-is-at-least-32-bytes';
const resultSecret = 'result-secret-that-is-at-least-32-bytes';
const now = new Date('2026-09-23T10:00:00.000Z');
const scope = {
  ownerId: 'owner-1',
  channel: 'web',
  conversationId: 'conversation-1',
};

test('production WebResearchPort consumes initial allowance before one signed Relay RPC and maps scalar evidence with Worker time', async () => {
  const consumptionCalls = [];
  const rpcCalls = [];
  const allowance = {
    sessionId: 'session-1',
    phase: 'initial',
    queryOrUrlsDigest: 'a'.repeat(64),
    maxCounts: { searchQueries: 1, pageRequests: 3 },
    maxDurationMs: 35_000,
    requestTimeoutMs: 15_000,
    maxRedirects: 3,
    deadline: '2026-09-23T10:00:35.000Z',
    requestId: 'relay-request-1',
  };
  const port = createResearchRelayWebResearchPort({
    statePort: {
      async consumeResearchPhase(input) {
        consumptionCalls.push(input);
        return { kind: 'consumed', allowance };
      },
    },
    allowanceKey: { keyVersion: 'allowance-v1', secret: allowanceSecret },
    resultKeys: { 'result-v1': resultSecret },
    clock: { now: () => now },
    requestIds: { nextId: () => 'relay-request-1' },
    relay: {
      async invoke(input) {
        rpcCalls.push(input);
        const verified = await verifyResearchAllowance(input.allowance, {
          keys: { 'allowance-v1': allowanceSecret },
          now,
        });
        assert.ok(verified);
        assert.deepEqual(input.payload, {
          phase: 'initial',
          query: '鮨 さいとう',
        });
        return {
          status: 'ok',
          result: await signResearchResult({
            requestId: allowance.requestId,
            allowanceDigest: verified.allowanceDigest,
            outcome: {
              kind: 'observed',
              proposal: {
                tabelog: {
                  status: 'known',
                  score: 4.2,
                  reviewCount: 120,
                  url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/',
                },
                reservation: {
                  status: 'known',
                  mode: 'reservation_required',
                  label: 'Reservation required',
                  advanceDays: 14,
                  url: 'https://restaurant.example/reservations',
                },
              },
            },
            usage: {
              searchQueries: 1,
              pageRequests: 2,
              elapsedMs: 500,
              maximumRedirectsFollowed: 1,
            },
            expiresAt: allowance.deadline,
            key: { keyVersion: 'result-v1', secret: resultSecret },
            now,
          }),
        };
      },
    },
  });

  assert.deepEqual(
    await port.research({
      phase: 'initial',
      scope,
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      queryOrUrlsDigest: 'a'.repeat(64),
      normalizedOwnerQuery: '鮨 さいとう',
    }),
    {
      kind: 'observed',
      value: {
        tabelog: {
          status: 'known',
          score: 4.2,
          reviewCount: 120,
          url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/',
          provenance: 'agent_observed',
          observedAt: now.toISOString(),
          freshness: 'fresh',
        },
        reservation: {
          status: 'known',
          mode: 'reservation_required',
          label: 'Reservation required',
          advanceDays: 14,
          url: 'https://restaurant.example/reservations',
          provenance: 'agent_observed',
          observedAt: now.toISOString(),
          freshness: 'fresh',
        },
      },
    },
  );
  assert.deepEqual(consumptionCalls, [
    {
      scope,
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      phase: 'initial',
      queryOrUrlsDigest: 'a'.repeat(64),
      requestId: 'relay-request-1',
    },
  ]);
  assert.equal(rpcCalls.length, 1);
});

test('production WebResearchPort spends response-loss once and returns manual unknown without retry or leaked failure', async () => {
  let consumeCalls = 0;
  let rpcCalls = 0;
  const port = createResearchRelayWebResearchPort({
    statePort: {
      async consumeResearchPhase() {
        consumeCalls += 1;
        return consumeCalls === 1
          ? {
              kind: 'consumed',
              allowance: initialAllowance({
                requestId: `relay-${consumeCalls}`,
              }),
            }
          : { kind: 'already_spent' };
      },
    },
    allowanceKey: { keyVersion: 'allowance-v1', secret: allowanceSecret },
    resultKeys: { 'result-v1': resultSecret },
    clock: { now: () => now },
    requestIds: { nextId: () => `relay-${consumeCalls + 1}` },
    relay: {
      async invoke() {
        rpcCalls += 1;
        throw new Error('private relay response-loss detail');
      },
    },
  });
  const input = initialInput();

  assert.deepEqual(await port.research(input), { kind: 'response_lost' });
  assert.deepEqual(await port.research(input), { kind: 'already_spent' });
  assert.equal(consumeCalls, 2);
  assert.equal(rpcCalls, 1);
  assert.doesNotMatch(JSON.stringify(await port.research(input)), /private/u);
  assert.equal(rpcCalls, 1);
});

test('production WebResearchPort makes no RPC for old, expired, or wrong-scope allowance claims', async () => {
  for (const kind of ['already_spent', 'expired', 'conflict']) {
    let rpcCalls = 0;
    const port = createResearchRelayWebResearchPort({
      statePort: {
        async consumeResearchPhase() {
          return { kind };
        },
      },
      allowanceKey: { keyVersion: 'allowance-v1', secret: allowanceSecret },
      resultKeys: { 'result-v1': resultSecret },
      clock: { now: () => now },
      requestIds: { nextId: () => 'relay-denied' },
      relay: {
        async invoke() {
          rpcCalls += 1;
          throw new Error('must not call');
        },
      },
    });

    assert.deepEqual(await port.research(initialInput()), { kind });
    assert.equal(rpcCalls, 0, kind);
  }
});

test('production WebResearchPort uses the exact confirm URLs and zero-search allowance and rejects invalid or expired results', async () => {
  const canonicalUrls = [
    'https://restaurant.example/reservations',
    'https://tabelog.com/tokyo/A1307/A130701/13000001/',
  ];
  for (const resultKind of ['invalid', 'expired']) {
    let rpcCalls = 0;
    const allowance = {
      ...initialAllowance({ requestId: `confirm-${resultKind}` }),
      phase: 'confirm',
      queryOrUrlsDigest: 'b'.repeat(64),
      maxCounts: { searchQueries: 0, pageRequests: 2 },
      maxDurationMs: 25_000,
      deadline: '2026-09-23T10:00:25.000Z',
    };
    const receiptTime =
      resultKind === 'expired' ? new Date('2026-09-23T10:00:25.000Z') : now;
    const port = createResearchRelayWebResearchPort({
      statePort: {
        async consumeResearchPhase(input) {
          assert.equal(input.phase, 'confirm');
          assert.equal(input.queryOrUrlsDigest, 'b'.repeat(64));
          return { kind: 'consumed', allowance };
        },
      },
      allowanceKey: { keyVersion: 'allowance-v1', secret: allowanceSecret },
      resultKeys: { 'result-v1': resultSecret },
      clock: {
        now: () => (rpcCalls === 0 ? now : receiptTime),
      },
      requestIds: { nextId: () => `confirm-${resultKind}` },
      relay: {
        async invoke(input) {
          rpcCalls += 1;
          const verified = await verifyResearchAllowance(input.allowance, {
            keys: { 'allowance-v1': allowanceSecret },
            now,
          });
          assert.ok(verified);
          assert.equal(verified.allowance.maxCounts.searchQueries, 0);
          assert.deepEqual(input.payload, {
            phase: 'confirm',
            canonicalUrls,
          });
          return resultKind === 'invalid'
            ? { status: 'ok', result: { expanded: 'raw relay output' } }
            : {
                status: 'ok',
                result: await signResearchResult({
                  requestId: allowance.requestId,
                  allowanceDigest: verified.allowanceDigest,
                  outcome: {
                    kind: 'observed',
                    proposal: {
                      tabelog: { status: 'unknown' },
                      reservation: { status: 'unknown' },
                    },
                  },
                  usage: {
                    searchQueries: 0,
                    pageRequests: 0,
                    elapsedMs: 1,
                    maximumRedirectsFollowed: 0,
                  },
                  expiresAt: allowance.deadline,
                  key: { keyVersion: 'result-v1', secret: resultSecret },
                  now,
                }),
              };
        },
      },
    });

    assert.deepEqual(
      await port.research({
        phase: 'confirm',
        scope,
        sessionId: 'session-1',
        expectedSessionVersion: 2,
        queryOrUrlsDigest: 'b'.repeat(64),
        canonicalUrls,
      }),
      { kind: 'unavailable' },
    );
    assert.equal(rpcCalls, 1);
  }
});

test('production WebResearchPort maps signed unavailable separately from benign observed unknown', async () => {
  for (const outcome of [
    { kind: 'unavailable' },
    {
      kind: 'observed',
      proposal: {
        tabelog: { status: 'unknown' },
        reservation: { status: 'unknown' },
      },
    },
  ]) {
    const allowance = initialAllowance({
      requestId: `outcome-${outcome.kind}`,
    });
    const port = createResearchRelayWebResearchPort({
      statePort: {
        async consumeResearchPhase() {
          return { kind: 'consumed', allowance };
        },
      },
      allowanceKey: { keyVersion: 'allowance-v1', secret: allowanceSecret },
      resultKeys: { 'result-v1': resultSecret },
      clock: { now: () => now },
      requestIds: { nextId: () => allowance.requestId },
      relay: {
        async invoke({ allowance: signedAllowance }) {
          const verified = await verifyResearchAllowance(signedAllowance, {
            keys: { 'allowance-v1': allowanceSecret },
            now,
          });
          return {
            status: 'ok',
            result: await signResearchResult({
              requestId: allowance.requestId,
              allowanceDigest: verified.allowanceDigest,
              outcome,
              usage: {
                searchQueries: 1,
                pageRequests: 0,
                elapsedMs: 1,
                maximumRedirectsFollowed: 0,
              },
              expiresAt: allowance.deadline,
              key: { keyVersion: 'result-v1', secret: resultSecret },
              now,
            }),
          };
        },
      },
    });

    assert.deepEqual(
      await port.research(initialInput()),
      outcome.kind === 'unavailable'
        ? { kind: 'unavailable' }
        : {
            kind: 'observed',
            value: {
              tabelog: { status: 'unknown' },
              reservation: { status: 'unknown' },
            },
          },
    );
  }
});

test(
  'production WebResearchPort aborts one never-settling RPC at the allowance deadline without retry or redirect',
  { timeout: 1_000 },
  async () => {
    const startedAt = new Date();
    const allowance = {
      ...initialAllowance({ requestId: 'deadline-request' }),
      deadline: new Date(startedAt.getTime() + 30).toISOString(),
    };
    let rpcCalls = 0;
    let aborted = false;
    const port = createResearchRelayWebResearchPort({
      statePort: {
        async consumeResearchPhase() {
          return { kind: 'consumed', allowance };
        },
      },
      allowanceKey: { keyVersion: 'allowance-v1', secret: allowanceSecret },
      resultKeys: { 'result-v1': resultSecret },
      clock: { now: () => new Date() },
      requestIds: { nextId: () => 'deadline-request' },
      relay: {
        async invoke(input) {
          rpcCalls += 1;
          assert.equal(input.deadlineAtMs, Date.parse(allowance.deadline));
          assert.equal(input.maxAttempts, 1);
          assert.equal(input.redirect, 'error');
          await new Promise((resolve, reject) => {
            input.signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(input.signal.reason);
              },
              { once: true },
            );
          });
        },
      },
    });

    assert.deepEqual(await port.research(initialInput()), {
      kind: 'unavailable',
    });
    assert.equal(rpcCalls, 1);
    assert.equal(aborted, true);
  },
);

function initialAllowance(overrides = {}) {
  return {
    sessionId: 'session-1',
    phase: 'initial',
    queryOrUrlsDigest: 'a'.repeat(64),
    maxCounts: { searchQueries: 1, pageRequests: 3 },
    maxDurationMs: 35_000,
    requestTimeoutMs: 15_000,
    maxRedirects: 3,
    deadline: '2026-09-23T10:00:35.000Z',
    requestId: 'relay-request-1',
    ...overrides,
  };
}

function initialInput() {
  return {
    phase: 'initial',
    scope,
    sessionId: 'session-1',
    expectedSessionVersion: 1,
    queryOrUrlsDigest: 'a'.repeat(64),
    normalizedOwnerQuery: '鮨 さいとう',
  };
}
