import assert from 'node:assert/strict';
import test from 'node:test';

import {
  signResearchAllowance,
  signResearchResult,
  verifyResearchAllowance,
  verifyResearchResult,
} from './research-relay-envelope.ts';

const now = new Date('2026-09-23T10:00:00.000Z');
const key = { keyVersion: 'relay-k1', secret: 's'.repeat(32) };
const keys = { 'relay-k1': key.secret };
const allowance = {
  sessionId: 'session-1',
  phase: 'initial',
  queryOrUrlsDigest: 'a'.repeat(64),
  maxCounts: { searchQueries: 1, pageRequests: 3 },
  maxDurationMs: 35_000,
  requestTimeoutMs: 15_000,
  maxRedirects: 3,
  deadline: '2026-09-23T10:00:35.000Z',
  requestId: 'request-1',
};

test('Research Relay allowance and result signatures bind their complete closed contracts', async () => {
  const signedAllowance = await signResearchAllowance({ allowance, key, now });
  const verifiedAllowance = await verifyResearchAllowance(signedAllowance, {
    keys,
    now,
  });
  assert.deepEqual(verifiedAllowance, {
    allowance,
    allowanceDigest: signedAllowance.allowanceDigest,
  });
  assert.equal(
    signedAllowance.allowanceDigest,
    '220f19d1d5bf9ef18db31a14af54ca3db21045a38090f4214c11d38a33557db2',
  );
  assert.equal(
    signedAllowance.signature,
    '01256ff694cc39d7a17f421b8ebfc3b21374635311110df4567951bb63b4a5c4',
  );
  await assert.rejects(
    signResearchAllowance({
      allowance: {
        ...allowance,
        deadline: '2026-09-23T10:00:36.000Z',
      },
      key,
      now,
    }),
    /Invalid research allowance/u,
  );

  for (const invalid of [
    { ...signedAllowance, audience: 'another-service' },
    { ...signedAllowance, version: 2 },
    { ...signedAllowance, keyVersion: 'unknown-key' },
    { ...signedAllowance, expiresAt: now.toISOString() },
    {
      ...signedAllowance,
      allowance: { ...allowance, phase: 'confirm' },
    },
    { ...signedAllowance, allowanceDigest: 'b'.repeat(64) },
    { ...signedAllowance, signature: '0'.repeat(64) },
    { ...signedAllowance, raw: '<html>forbidden</html>' },
  ]) {
    assert.equal(
      await verifyResearchAllowance(invalid, { keys, now }),
      undefined,
    );
  }

  const proposal = {
    tabelog: {
      status: 'known',
      score: 3.82,
      reviewCount: 42,
      url: 'https://tabelog.com/tokyo/A1301/A130101/13000001/',
    },
    reservation: {
      status: 'known',
      mode: 'reservation_required',
      label: 'Reservations required',
      advanceDays: 7,
      url: 'https://restaurant.example/reservations',
    },
  };
  const usage = {
    searchQueries: 1,
    pageRequests: 2,
    elapsedMs: 12_000,
    maximumRedirectsFollowed: 1,
  };
  const signedResult = await signResearchResult({
    requestId: allowance.requestId,
    allowanceDigest: signedAllowance.allowanceDigest,
    outcome: { kind: 'observed', proposal },
    usage,
    expiresAt: allowance.deadline,
    key,
    now,
  });
  assert.equal(
    signedResult.signature,
    'cd48232acf477864b7e47af1dae3cc2657542c99f75e6335336f1ecda0e32fb5',
  );
  assert.deepEqual(
    await verifyResearchResult(signedResult, {
      keys,
      now,
      allowance,
      allowanceDigest: signedAllowance.allowanceDigest,
    }),
    { outcome: { kind: 'observed', proposal }, usage },
  );

  for (const invalid of [
    { ...signedResult, requestId: 'another-request' },
    { ...signedResult, allowanceDigest: 'b'.repeat(64) },
    {
      ...signedResult,
      usage: { ...usage, pageRequests: 4 },
    },
    {
      ...signedResult,
      outcome: {
        kind: 'observed',
        proposal: {
          ...proposal,
          tabelog: {
            ...proposal.tabelog,
            provenance: 'agent_observed',
            observedAt: '2026-09-23T10:00:10.000Z',
            freshness: 'fresh',
          },
        },
      },
    },
    {
      ...signedResult,
      outcome: { kind: 'unavailable', proposal },
    },
    { ...signedResult, outcome: { kind: 'unavailable' } },
    { ...signedResult, reviewText: 'forbidden' },
  ]) {
    assert.equal(
      await verifyResearchResult(invalid, {
        keys,
        now,
        allowance,
        allowanceDigest: signedAllowance.allowanceDigest,
      }),
      undefined,
    );
  }

  const unavailable = await signResearchResult({
    requestId: allowance.requestId,
    allowanceDigest: signedAllowance.allowanceDigest,
    outcome: { kind: 'unavailable' },
    usage,
    expiresAt: allowance.deadline,
    key,
    now,
  });
  assert.equal(
    unavailable.signature,
    '50f3b6e87f6dc52eee8ea8b68408ecc983e19ec52a95ed87207c996a91fcf901',
  );
  assert.deepEqual(
    await verifyResearchResult(unavailable, {
      keys,
      now,
      allowance,
      allowanceDigest: signedAllowance.allowanceDigest,
    }),
    { outcome: { kind: 'unavailable' }, usage },
  );
  assert.notEqual(unavailable.signature, signedResult.signature);
});
