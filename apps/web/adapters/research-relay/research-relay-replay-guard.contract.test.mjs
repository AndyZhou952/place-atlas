import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  researchRelayReplaySchemaSql,
  SqliteResearchRelayReplayGuard,
} from './research-relay-replay-guard.ts';

test('persistent Relay replay guard claims before egress with one winner and no product data', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-reset-relay-replay-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'replay.sqlite');
  let sqlite = new DatabaseSync(databasePath);
  sqlite.exec(researchRelayReplaySchemaSql);
  const firstProcess = new SqliteResearchRelayReplayGuard(toDatabase(sqlite));
  const claim = {
    requestId: 'request-1',
    allowanceDigest: 'a'.repeat(64),
    expiresAt: '2026-09-23T10:01:00.000Z',
    now: new Date('2026-09-23T10:00:00.000Z'),
  };

  for (const invalid of [
    undefined,
    { ...claim, extra: true },
    { ...claim, requestId: 42 },
    { ...claim, allowanceDigest: 'not-a-digest' },
    { ...claim, expiresAt: 'not-a-time' },
    { ...claim, now: 'not-a-date' },
  ]) {
    assert.deepEqual(await firstProcess.claim(invalid), { kind: 'invalid' });
  }
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM relay_request_claims').get()
      .count,
    0,
  );

  assert.deepEqual(
    await Promise.all([firstProcess.claim(claim), firstProcess.claim(claim)]),
    [{ kind: 'claimed' }, { kind: 'replay' }],
  );
  sqlite.close();
  sqlite = new DatabaseSync(databasePath);
  const restartedProcess = new SqliteResearchRelayReplayGuard(
    toDatabase(sqlite),
  );
  assert.deepEqual(await restartedProcess.claim(claim), { kind: 'replay' });
  assert.deepEqual(
    await restartedProcess.claim({
      ...claim,
      allowanceDigest: 'b'.repeat(64),
    }),
    { kind: 'conflict' },
  );
  assert.deepEqual(
    await restartedProcess.claim({
      requestId: 'expired-request',
      allowanceDigest: 'c'.repeat(64),
      expiresAt: '2026-09-23T10:00:00.000Z',
      now: new Date('2026-09-23T10:00:00.000Z'),
    }),
    { kind: 'expired' },
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM relay_request_claims').get()
      .count,
    1,
  );
  assert.deepEqual(
    Object.keys(
      sqlite.prepare('SELECT * FROM relay_request_claims').get(),
    ).sort(),
    ['allowance_digest', 'expires_at_ms', 'request_id'],
  );
  assert.equal(
    await restartedProcess.cleanup(new Date('2026-09-23T10:01:00.000Z')),
    1,
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM relay_request_claims').get()
      .count,
    0,
  );
  sqlite.close();
});

function toDatabase(sqlite) {
  return {
    prepare(sql) {
      return {
        run(...values) {
          const result = sqlite.prepare(sql).run(...values);
          return { changes: Number(result.changes) };
        },
        get(...values) {
          return sqlite.prepare(sql).get(...values);
        },
      };
    },
  };
}
