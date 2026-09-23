import assert from 'node:assert/strict';
import test from 'node:test';

import { createT08OwnerPocHarness } from './t08-owner-poc-e2e-fixture.mjs';

test('T-08 traverses the model-free owner command path for the three Ginza spellings', async () => {
  const harness = createT08OwnerPocHarness();

  for (const locationHint of ['银座', '銀座', 'ginza']) {
    const reply = await harness.dispatchOwnerCommand(
      `/jpmap nearby ${locationHint}`,
    );
    assert.match(reply, /Japan Atlas｜附近推荐/u);
  }

  assert.deepEqual(harness.locationHints, ['银座', '銀座', 'ginza']);
  assert.equal(harness.modelCalls, 0);
  assert.deepEqual(
    harness.audits.map(({ operation, resultKind }) => [operation, resultKind]),
    [
      ['nearby.recommend', 'success'],
      ['nearby.recommend', 'success'],
      ['nearby.recommend', 'success'],
    ],
  );
});

test('T-08 rejects second-account and group commands before Worker egress', async () => {
  const harness = createT08OwnerPocHarness();

  assert.equal(
    await harness.dispatchSecondAccount('/jpmap nearby 銀座'),
    'Japan Atlas 配置不可用，请联系管理员。',
  );
  assert.equal(
    await harness.dispatchGroup('/jpmap nearby 銀座'),
    'Japan Atlas 配置不可用，请联系管理员。',
  );

  assert.equal(harness.workerRequests, 0);
  assert.equal(harness.modelCalls, 0);
  assert.deepEqual(harness.audits, []);
});

test('T-08 records wrong-scope and nonce-replay denials without provider execution', async () => {
  const wrongScope = createT08OwnerPocHarness({ scopes: [] });
  const wrongScopeResponse = await wrongScope.sendSignedWorkerRequest({
    nonce: 'wrong-scope-nonce',
  });

  assert.equal(wrongScopeResponse.status, 403);
  assert.equal((await wrongScopeResponse.json()).error.kind, 'forbidden');
  assert.deepEqual(wrongScope.locationHints, []);
  assert.deepEqual(
    wrongScope.audits.map(({ operation, resultKind }) => [
      operation,
      resultKind,
    ]),
    [['nearby.recommend', 'forbidden']],
  );

  const replay = createT08OwnerPocHarness();
  const request = await replay.createSignedWorkerRequest({
    nonce: 'replayed-nonce',
  });
  const repeatedRequest = request.clone();
  const first = await replay.handleWorkerRequest(request);
  const repeated = await replay.handleWorkerRequest(repeatedRequest);

  assert.equal(first.status, 200);
  assert.equal(repeated.status, 401);
  assert.equal((await repeated.json()).error.kind, 'unauthorized');
  assert.deepEqual(replay.locationHints, ['银座']);
  assert.deepEqual(
    replay.audits.map(({ operation, resultKind }) => [operation, resultKind]),
    [
      ['nearby.recommend', 'success'],
      ['unknown', 'unauthorized'],
    ],
  );
});
