import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { D1CatalogIntakeState } from './d1-catalog-intake-state.ts';

const migration = new URL(
  '../../../../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/0006_catalog_intake_sessions.sql',
  import.meta.url,
);
const publicationMigration = new URL(
  '../../../../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/0008_catalog_intake_publication.sql',
  import.meta.url,
);
const researchAllowanceMigration = new URL(
  '../../../../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/0009_catalog_intake_research_allowances.sql',
  import.meta.url,
);
const scope = {
  ownerId: 'owner-1',
  channel: 'wechat',
  conversationId: 'conversation-1',
};

test('D1 intake state persists scoped minimal candidates, replaces active sessions atomically, and CASes transitions', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const sql = await readFile(migration, 'utf8');
  sqlite.exec(sql);
  sqlite.exec(sql);
  const publicationSql = await readFile(publicationMigration, 'utf8');
  sqlite.exec(publicationSql);
  sqlite.exec(publicationSql);
  const researchSql = await readFile(researchAllowanceMigration, 'utf8');
  sqlite.exec(researchSql);
  sqlite.exec(researchSql);
  const database = toD1(sqlite);
  const state = new D1CatalogIntakeState(database, {
    now: () => new Date('2026-09-22T10:10:00.000Z'),
  });
  const first = candidateSession('session-1', 'request-1', '銀座 鮨');

  assert.equal((await state.createReplacingActive(first)).kind, 'created');
  assert.equal(
    (await new D1CatalogIntakeState(database).get(scope, 'session-1')).state,
    'candidates_ready',
  );
  const stored = sqlite
    .prepare(
      'SELECT session_json FROM catalog_intake_sessions WHERE session_id = ?',
    )
    .get('session-1').session_json;
  assert.doesNotMatch(stored, /Google Maps|Transient|candidateHash/u);
  assert.deepEqual(Object.keys(JSON.parse(stored).candidates[0]).sort(), [
    'createdAt',
    'ordinal',
    'placeId',
    'providerNamespace',
  ]);

  assert.equal((await state.createReplacingActive(first)).kind, 'replay');
  assert.equal(
    (
      await state.createReplacingActive({
        ...first,
        ownerQuery: 'Ginza sushi',
        normalizedOwnerQuery: 'Ginza sushi',
      })
    ).kind,
    'conflict',
  );

  const second = candidateSession('session-2', 'request-2', 'Ginza sushi');
  assert.equal((await state.createReplacingActive(second)).kind, 'created');
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS count FROM catalog_intake_sessions')
      .get().count,
    1,
  );
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS count FROM catalog_intake_terminal_refs')
      .get().count,
    1,
  );
  assert.equal((await state.get(scope, 'session-1')).state, 'cancelled');

  const next = {
    ...second,
    sessionVersion: 2,
    lastAcceptedActivityAt: '2026-09-22T10:10:00.000Z',
    expiresAt: '2026-09-22T10:40:00.000Z',
  };
  assert.equal(
    (
      await state.compareAndSwap({
        scope,
        sessionId: 'session-2',
        expectedVersion: 1,
        next,
      })
    ).kind,
    'applied',
  );
  assert.equal(
    (
      await state.compareAndSwap({
        scope,
        sessionId: 'session-2',
        expectedVersion: 1,
        next,
      })
    ).kind,
    'conflict',
  );
  assert.equal(
    await state.get(
      { ...scope, conversationId: 'another-conversation' },
      'session-2',
    ),
    undefined,
  );
});

test('D1 resolves the active Add conversation before the most recent committed receipt', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  const now = new Date('2026-09-22T10:10:00.000Z');
  const state = new D1CatalogIntakeState(toD1(sqlite), { now: () => now });
  const active = candidateSession('session-active', 'request-active', '鮨');
  await state.createReplacingActive(active);
  const committed = {
    ...scope,
    sessionId: 'session-committed',
    sessionVersion: 4,
    state: 'committed',
    committedFromVersion: 3,
    requestToken: 'request-committed',
    normalizedOwnerQuery: '鮨青空',
    terminalAt: '2026-09-22T10:05:00.000Z',
    retainUntil: '2027-03-21T10:05:00.000Z',
    mutationKey: 'mutation-1',
    previewVersion: 3,
    evidenceDigest: 'a'.repeat(64),
    outcome: {
      status: 'committed_verified',
      itemId: 'item-1',
      receiptRef: 'receipt-1',
      replayed: false,
    },
  };
  sqlite
    .prepare(
      'INSERT INTO catalog_intake_terminal_refs ' +
        '(session_id, owner_id, channel, conversation_id, state, ' +
        'session_version, source_version, request_token, normalized_owner_query, ' +
        'terminal_at_ms, retain_until_ms, terminal_json) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      committed.sessionId,
      committed.ownerId,
      committed.channel,
      committed.conversationId,
      committed.state,
      committed.sessionVersion,
      committed.committedFromVersion,
      committed.requestToken,
      committed.normalizedOwnerQuery,
      Date.parse(committed.terminalAt),
      Date.parse(committed.retainUntil),
      JSON.stringify(committed),
    );

  assert.deepEqual(await state.resolve(scope), {
    state: 'candidates_ready',
    sessionId: 'session-active',
    sessionVersion: 1,
  });
  sqlite.exec('DELETE FROM catalog_intake_sessions');
  assert.deepEqual(await state.resolve(scope), {
    state: 'committed',
    sessionId: 'session-committed',
    sessionVersion: 4,
    previewVersion: 3,
  });
  const cancelled = {
    ...scope,
    sessionId: 'session-cancelled',
    sessionVersion: 2,
    state: 'cancelled',
    cancelledFromVersion: 1,
    requestToken: 'request-cancelled',
    normalizedOwnerQuery: '天ぷら',
    terminalAt: '2026-09-22T10:06:00.000Z',
    retainUntil: '2027-03-21T10:06:00.000Z',
  };
  sqlite
    .prepare(
      'INSERT INTO catalog_intake_terminal_refs ' +
        '(session_id, owner_id, channel, conversation_id, state, ' +
        'session_version, source_version, request_token, normalized_owner_query, ' +
        'terminal_at_ms, retain_until_ms, terminal_json) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      cancelled.sessionId,
      cancelled.ownerId,
      cancelled.channel,
      cancelled.conversationId,
      cancelled.state,
      cancelled.sessionVersion,
      cancelled.cancelledFromVersion,
      cancelled.requestToken,
      cancelled.normalizedOwnerQuery,
      Date.parse(cancelled.terminalAt),
      Date.parse(cancelled.retainUntil),
      JSON.stringify(cancelled),
    );
  const expired = {
    ...scope,
    sessionId: 'session-expired',
    sessionVersion: 2,
    state: 'expired',
    expiredFromVersion: 1,
    expiredAt: '2026-09-22T10:07:00.000Z',
    terminalAt: '2026-09-22T10:07:00.000Z',
    retainUntil: '2026-09-23T10:07:00.000Z',
  };
  sqlite
    .prepare(
      'INSERT INTO catalog_intake_terminal_refs ' +
        '(session_id, owner_id, channel, conversation_id, state, ' +
        'session_version, source_version, request_token, normalized_owner_query, ' +
        'terminal_at_ms, retain_until_ms, terminal_json) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      expired.sessionId,
      expired.ownerId,
      expired.channel,
      expired.conversationId,
      expired.state,
      expired.sessionVersion,
      expired.expiredFromVersion,
      'request-expired',
      '焼鳥',
      Date.parse(expired.terminalAt),
      Date.parse(expired.retainUntil),
      JSON.stringify(expired),
    );
  assert.deepEqual(await state.resolve(scope), {
    state: 'committed',
    sessionId: 'session-committed',
    sessionVersion: 4,
    previewVersion: 3,
  });
  assert.equal(
    await state.resolve({ ...scope, conversationId: 'other-dm' }),
    undefined,
  );
});

test('D1 intake state atomically consumes the initial research phase once with its reserved budget', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(researchAllowanceMigration, 'utf8'));
  const now = new Date('2026-09-22T10:00:00.000Z');
  const state = new D1CatalogIntakeState(toD1(sqlite), { now: () => now });
  const session = candidateSession(
    'session-research',
    'request-research',
    '鮨',
  );
  await state.createReplacingActive(session);

  assert.deepEqual(
    await state.consumeResearchPhase({
      scope,
      sessionId: session.sessionId,
      expectedSessionVersion: 1,
      phase: 'initial',
      queryOrUrlsDigest: 'f'.repeat(64),
      requestId: 'research-substitution',
    }),
    { kind: 'conflict' },
  );

  assert.deepEqual(
    await state.consumeResearchPhase({
      scope,
      sessionId: session.sessionId,
      expectedSessionVersion: 1,
      phase: 'initial',
      queryOrUrlsDigest: 'a'.repeat(64),
      requestId: 'research-request-1',
    }),
    {
      kind: 'consumed',
      allowance: {
        sessionId: session.sessionId,
        phase: 'initial',
        queryOrUrlsDigest: 'a'.repeat(64),
        maxCounts: { searchQueries: 1, pageRequests: 3 },
        maxDurationMs: 35_000,
        requestTimeoutMs: 15_000,
        maxRedirects: 3,
        deadline: '2026-09-22T10:00:35.000Z',
        requestId: 'research-request-1',
      },
    },
  );
  assert.deepEqual(
    await state.consumeResearchPhase({
      scope,
      sessionId: session.sessionId,
      expectedSessionVersion: 1,
      phase: 'initial',
      queryOrUrlsDigest: 'a'.repeat(64),
      requestId: 'research-request-2',
    }),
    { kind: 'already_spent' },
  );
  assert.equal(
    sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM catalog_intake_research_phase_spends',
      )
      .get().count,
    1,
  );
});

test('D1 intake state keeps the confirm reserve separate from the spent initial phase', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(researchAllowanceMigration, 'utf8'));
  const now = new Date('2026-09-22T10:00:00.000Z');
  const state = new D1CatalogIntakeState(toD1(sqlite), { now: () => now });
  const session = candidateSession(
    'session-confirm-research',
    'request-confirm-research',
    '鮨',
  );
  await state.createReplacingActive(session);
  assert.equal(
    (
      await state.consumeResearchPhase({
        scope,
        sessionId: session.sessionId,
        expectedSessionVersion: 1,
        phase: 'initial',
        queryOrUrlsDigest: 'a'.repeat(64),
        requestId: 'research-initial',
      })
    ).kind,
    'consumed',
  );
  sqlite
    .prepare(
      "UPDATE catalog_intake_sessions SET state = 'preview_ready', session_version = 2, session_json = ? WHERE session_id = ?",
    )
    .run(
      JSON.stringify({
        ...session,
        state: 'preview_ready',
        sessionVersion: 2,
        researchPhaseDigests: {
          ...session.researchPhaseDigests,
          confirm: 'b'.repeat(64),
        },
      }),
      session.sessionId,
    );

  assert.deepEqual(
    await state.consumeResearchPhase({
      scope,
      sessionId: session.sessionId,
      expectedSessionVersion: 2,
      phase: 'confirm',
      queryOrUrlsDigest: 'b'.repeat(64),
      requestId: 'research-confirm',
    }),
    {
      kind: 'consumed',
      allowance: {
        sessionId: session.sessionId,
        phase: 'confirm',
        queryOrUrlsDigest: 'b'.repeat(64),
        maxCounts: { searchQueries: 0, pageRequests: 2 },
        maxDurationMs: 25_000,
        requestTimeoutMs: 15_000,
        maxRedirects: 3,
        deadline: '2026-09-22T10:00:25.000Z',
        requestId: 'research-confirm',
      },
    },
  );
  assert.equal(
    sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM catalog_intake_research_phase_spends WHERE session_id = ?',
      )
      .get(session.sessionId).count,
    2,
  );
});

test('D1 research allowance binds the exact authoritative preview digest and rejects edit races', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(researchAllowanceMigration, 'utf8'));
  const state = new D1CatalogIntakeState(toD1(sqlite), {
    now: () => new Date('2026-09-22T10:00:00.000Z'),
  });
  const session = candidateSession(
    'session-digest-race',
    'request-digest-race',
    '鮨',
  );
  await state.createReplacingActive(session);

  const previewSession = {
    ...session,
    state: 'preview_ready',
    sessionVersion: 2,
    researchPhaseDigests: {
      ...session.researchPhaseDigests,
      confirm: 'b'.repeat(64),
    },
  };
  sqlite
    .prepare(
      "UPDATE catalog_intake_sessions SET state = 'preview_ready', session_version = 2, session_json = ? WHERE session_id = ?",
    )
    .run(JSON.stringify(previewSession), session.sessionId);

  for (const digest of ['a'.repeat(64), 'c'.repeat(64)]) {
    assert.deepEqual(
      await state.consumeResearchPhase({
        scope,
        sessionId: session.sessionId,
        expectedSessionVersion: 2,
        phase: 'confirm',
        queryOrUrlsDigest: digest,
        requestId: `substitution-${digest[0]}`,
      }),
      { kind: 'conflict' },
    );
  }
  assert.equal(
    sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM catalog_intake_research_phase_spends WHERE session_id = ?',
      )
      .get(session.sessionId).count,
    0,
  );

  sqlite
    .prepare(
      'UPDATE catalog_intake_sessions SET session_json = ? WHERE session_id = ?',
    )
    .run(
      JSON.stringify({
        ...previewSession,
        researchPhaseDigests: {
          ...previewSession.researchPhaseDigests,
          confirm: 'c'.repeat(64),
        },
      }),
      session.sessionId,
    );
  assert.deepEqual(
    await state.consumeResearchPhase({
      scope,
      sessionId: session.sessionId,
      expectedSessionVersion: 2,
      phase: 'confirm',
      queryOrUrlsDigest: 'b'.repeat(64),
      requestId: 'stale-preview-edit-race',
    }),
    { kind: 'conflict' },
  );
  assert.equal(
    (
      await state.consumeResearchPhase({
        scope,
        sessionId: session.sessionId,
        expectedSessionVersion: 2,
        phase: 'confirm',
        queryOrUrlsDigest: 'c'.repeat(64),
        requestId: 'current-preview',
      })
    ).kind,
    'consumed',
  );
});

test('D1 research phase consumption fails closed outside the exact active scope and TTL', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(researchAllowanceMigration, 'utf8'));
  let now = new Date('2026-09-22T10:00:00.000Z');
  const state = new D1CatalogIntakeState(toD1(sqlite), { now: () => now });
  const session = candidateSession(
    'session-scoped-research',
    'request-scoped-research',
    '鮨',
  );
  await state.createReplacingActive(session);
  assert.equal(
    (
      await state.consumeResearchPhase({
        scope,
        sessionId: session.sessionId,
        expectedSessionVersion: 1,
        phase: 'initial',
        queryOrUrlsDigest: 'a'.repeat(64),
        requestId: 'research-owner',
      })
    ).kind,
    'consumed',
  );
  assert.deepEqual(
    await state.consumeResearchPhase({
      scope: { ...scope, ownerId: 'another-owner' },
      sessionId: session.sessionId,
      expectedSessionVersion: 1,
      phase: 'initial',
      queryOrUrlsDigest: 'a'.repeat(64),
      requestId: 'research-attacker',
    }),
    { kind: 'conflict' },
  );

  const expired = candidateSession(
    'session-expired-research',
    'request-expired-research',
    '蕎麦',
  );
  await state.createReplacingActive(expired);
  now = new Date(expired.expiresAt);
  assert.deepEqual(
    await state.consumeResearchPhase({
      scope,
      sessionId: expired.sessionId,
      expectedSessionVersion: 1,
      phase: 'initial',
      queryOrUrlsDigest: 'b'.repeat(64),
      requestId: 'research-expired',
    }),
    { kind: 'expired' },
  );
  now = new Date('2026-09-22T10:00:00.000Z');
  const wrongPhase = candidateSession(
    'session-wrong-phase',
    'request-wrong-phase',
    '天ぷら',
  );
  await state.createReplacingActive(wrongPhase);
  sqlite
    .prepare(
      "UPDATE catalog_intake_sessions SET state = 'preview_ready', session_version = 2 WHERE session_id = ?",
    )
    .run(wrongPhase.sessionId);
  assert.deepEqual(
    await state.consumeResearchPhase({
      scope,
      sessionId: wrongPhase.sessionId,
      expectedSessionVersion: 2,
      phase: 'initial',
      queryOrUrlsDigest: 'c'.repeat(64),
      requestId: 'research-wrong-phase',
    }),
    { kind: 'conflict' },
  );
  assert.equal(
    sqlite
      .prepare(
        'SELECT COUNT(*) AS count FROM catalog_intake_research_phase_spends',
      )
      .get().count,
    1,
  );
});

test('D1 intake state rejects a persisted preview with duplicate or noncanonical warnings', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(researchAllowanceMigration, 'utf8'));
  const database = toD1(sqlite);
  const state = new D1CatalogIntakeState(database);
  const session = candidateSession(
    'session-warning-order',
    'request-warning',
    '鮨',
  );
  await state.createReplacingActive(session);
  sqlite
    .prepare(
      'UPDATE catalog_intake_sessions SET state = ?, session_json = ? WHERE session_id = ?',
    )
    .run(
      'preview_ready',
      JSON.stringify({
        ...session,
        state: 'preview_ready',
        preview: {
          warnings: [
            { code: 'needs_review', message: 'Owner review required.' },
            { code: 'provider_unavailable', message: 'Provider unavailable.' },
          ],
        },
      }),
      session.sessionId,
    );

  await assert.rejects(
    state.get(scope, session.sessionId),
    /invalid warning order/u,
  );
});

test('D1 cleanup converts expired payloads to minimal terminal references and retains request identity', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(publicationMigration, 'utf8'));
  sqlite.exec(await readFile(researchAllowanceMigration, 'utf8'));
  const state = new D1CatalogIntakeState(toD1(sqlite));
  await state.createReplacingActive(
    candidateSession('session-1', 'request-1', '银座 寿司'),
  );

  assert.deepEqual(await state.cleanup(new Date('2026-09-22T10:30:00.000Z')), {
    expired: 1,
    removed: 0,
  });
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS count FROM catalog_intake_sessions')
      .get().count,
    0,
  );
  const terminal = await state.get(scope, 'session-1');
  assert.equal(terminal.state, 'expired');
  assert.equal('candidates' in terminal, false);
  assert.equal(
    (await state.findByRequest(scope, 'request-1')).sessionId,
    'session-1',
  );

  assert.deepEqual(await state.cleanup(new Date('2026-09-23T10:30:00.000Z')), {
    expired: 0,
    removed: 0,
  });
  assert.equal((await state.get(scope, 'session-1')).state, 'expired');
  assert.equal(
    (await state.findByRequest(scope, 'request-1')).sessionId,
    'session-1',
  );

  const retainUntil = sqlite
    .prepare(
      'SELECT retain_until_ms FROM catalog_intake_terminal_refs WHERE session_id = ?',
    )
    .get('session-1').retain_until_ms;
  assert.deepEqual(await state.cleanup(new Date(retainUntil)), {
    expired: 0,
    removed: 1,
  });
  assert.equal(await state.get(scope, 'session-1'), undefined);
  assert.equal(await state.findByRequest(scope, 'request-1'), undefined);
});

test('D1 terminal collisions roll back replacement and terminal CAS without deleting the active session', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(publicationMigration, 'utf8'));
  sqlite.exec(await readFile(researchAllowanceMigration, 'utf8'));
  const state = new D1CatalogIntakeState(toD1(sqlite), {
    now: () => new Date('2026-09-22T10:05:00.000Z'),
  });
  const first = candidateSession('session-1', 'request-1', '銀座 鮨');
  await state.createReplacingActive(first);
  insertConflictingTerminal(sqlite, first);

  await assert.rejects(
    state.createReplacingActive(
      candidateSession('session-2', 'request-2', 'Ginza sushi'),
    ),
  );
  assert.equal((await state.get(scope, 'session-1')).state, 'candidates_ready');
  assert.equal(await state.get(scope, 'session-2'), undefined);
  assert.equal(await state.findByRequest(scope, 'request-2'), undefined);

  const cancelled = {
    sessionId: 'session-1',
    sessionVersion: 2,
    state: 'cancelled',
    ...scope,
    cancelledFromVersion: 1,
    requestToken: 'request-1',
    normalizedOwnerQuery: '銀座 鮨',
    terminalAt: '2026-09-22T10:10:00.000Z',
    retainUntil: '2027-03-21T10:10:00.000Z',
  };
  await assert.rejects(
    state.compareAndSwap({
      scope,
      sessionId: 'session-1',
      expectedVersion: 1,
      next: cancelled,
    }),
  );
  assert.equal((await state.get(scope, 'session-1')).state, 'candidates_ready');
});

test('D1 cleanup does not remove a session renewed before the scheduled sweep', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(publicationMigration, 'utf8'));
  sqlite.exec(await readFile(researchAllowanceMigration, 'utf8'));
  const state = new D1CatalogIntakeState(toD1(sqlite), {
    now: () => new Date('2026-09-22T10:29:59.000Z'),
  });
  const first = candidateSession('session-1', 'request-1', '銀座 鮨');
  await state.createReplacingActive(first);
  const renewed = {
    ...first,
    sessionVersion: 2,
    lastAcceptedActivityAt: '2026-09-22T10:29:59.000Z',
    expiresAt: '2026-09-22T10:59:59.000Z',
  };
  assert.equal(
    (
      await state.compareAndSwap({
        scope,
        sessionId: 'session-1',
        expectedVersion: 1,
        next: renewed,
      })
    ).kind,
    'applied',
  );

  assert.deepEqual(await state.cleanup(new Date('2026-09-22T10:30:00.000Z')), {
    expired: 0,
    removed: 0,
  });
  assert.equal((await state.get(scope, 'session-1')).sessionVersion, 2);
});

test('D1 active CAS cannot renew a session at the exact expiry boundary', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(publicationMigration, 'utf8'));
  sqlite.exec(await readFile(researchAllowanceMigration, 'utf8'));
  let now = new Date('2026-09-22T10:00:00.000Z');
  const state = new D1CatalogIntakeState(toD1(sqlite), { now: () => now });
  const first = candidateSession(
    'session-ttl-cas',
    'request-ttl-cas',
    '銀座 鮨',
  );
  await state.createReplacingActive(first);

  now = new Date(first.expiresAt);
  const renewed = {
    ...first,
    sessionVersion: 2,
    lastAcceptedActivityAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
  };
  const result = await state.compareAndSwap({
    scope,
    sessionId: first.sessionId,
    expectedVersion: first.sessionVersion,
    next: renewed,
  });

  assert.equal(result.kind, 'conflict');
  const stored = await state.get(scope, first.sessionId);
  assert.equal(stored.sessionVersion, 1);
  assert.equal(stored.expiresAt, first.expiresAt);
});

function candidateSession(sessionId, requestToken, ownerQuery) {
  return {
    ...scope,
    sessionId,
    sessionVersion: 1,
    state: 'candidates_ready',
    ownerQuery,
    normalizedOwnerQuery: ownerQuery,
    researchPhaseDigests: { initial: 'a'.repeat(64) },
    requestToken,
    hasMore: false,
    candidates: [
      {
        providerNamespace: 'google-places',
        placeId: 'place-1',
        ordinal: 1,
        createdAt: '2026-09-22T10:00:00.000Z',
      },
    ],
    catalogRevision: 'catalog-r1',
    createdAt: '2026-09-22T10:00:00.000Z',
    discoverExpiresAt: '2026-09-22T10:30:00.000Z',
    lastAcceptedActivityAt: '2026-09-22T10:00:00.000Z',
    expiresAt: '2026-09-22T10:30:00.000Z',
  };
}

function insertConflictingTerminal(sqlite, session) {
  const terminal = {
    sessionId: session.sessionId,
    sessionVersion: 2,
    state: 'cancelled',
    ...scope,
    cancelledFromVersion: 1,
    requestToken: session.requestToken,
    normalizedOwnerQuery: session.normalizedOwnerQuery,
    terminalAt: '2026-09-22T10:05:00.000Z',
    retainUntil: '2027-03-21T10:05:00.000Z',
  };
  sqlite
    .prepare(
      'INSERT INTO catalog_intake_terminal_refs ' +
        '(session_id, owner_id, channel, conversation_id, state, ' +
        'session_version, source_version, request_token, normalized_owner_query, ' +
        'terminal_at_ms, retain_until_ms, terminal_json) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      terminal.sessionId,
      terminal.ownerId,
      terminal.channel,
      terminal.conversationId,
      terminal.state,
      terminal.sessionVersion,
      terminal.cancelledFromVersion,
      terminal.requestToken,
      terminal.normalizedOwnerQuery,
      Date.parse(terminal.terminalAt),
      Date.parse(terminal.retainUntil),
      JSON.stringify(terminal),
    );
}

function toD1(database) {
  function prepare(sql) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      async run() {
        const result = database.prepare(sql).run(...values);
        return { success: true, meta: { changes: result.changes } };
      },
      async first() {
        return database.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...values) };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
