import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createAtlasApplication } from '../../../../product/application/atlas-application.ts';
import { createInvocationCoordinator } from '../../../../product/application/invocation/invocation-coordinator.ts';
import { createMediaOperationGroup } from '../../../../product/application/media/media-operations.ts';
import { D1MutationReceiptState } from '../d1-mutation-receipt-state.ts';
import { D1VisitMediaState } from './d1-visit-media-state.ts';

const migrationRoot = new URL(
  '../../../../migrations/owner-poc/',
  import.meta.url,
);

void test('R2 delete failure leaves only an unreachable orphan while response-lost retry replays success', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    await readFile(new URL('0001_owner_poc_schema.sql', migrationRoot), 'utf8'),
  );
  sqlite.exec(
    await readFile(
      new URL('0005_public_media_display_id.sql', migrationRoot),
      'utf8',
    ),
  );
  sqlite.exec(
    await readFile(
      new URL('0011_visit_media_score.sql', migrationRoot),
      'utf8',
    ),
  );
  sqlite.exec(
    `INSERT INTO visit_media
     (id, display_id, visit_id, item_id, object_key, original_filename,
      content_type, byte_size, content_sha256, caption, display_order,
      created_at, updated_at)
     VALUES ('media-1', 'display-1', 'visit-1', 'item-1',
             'visits/visit-1/media-1', 'photo.jpg', 'image/jpeg', 3,
             '${'a'.repeat(64)}', NULL, 0, 'created', 'created')`,
  );
  const database = toD1(sqlite);
  let objectDeletes = 0;
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new D1VisitMediaState(database),
      {
        async put() {},
        async get() {
          return undefined;
        },
        async delete() {
          objectDeletes += 1;
          throw new Error('simulated orphan cleanup failure');
        },
      },
      {
        clock: { now: () => '2026-09-21T00:00:00.000Z' },
        idSource: { nextId: () => 'unused' },
        digest: async () => 'unused',
      },
    ),
  );
  const coordinator = createInvocationCoordinator({
    application,
    receipts: new D1MutationReceiptState(database),
    clock: { nowMs: () => 1_000 },
    attemptToken: () => 'delete-attempt',
  });
  const envelope = {
    operation: 'media.delete',
    input: { id: 'media-1' },
    mutationId: 'delete-media-1',
    invocation: {
      principal: 'owner',
      channel: 'web',
      scopes: ['atlas:owner'],
      requestedAt: '2026-09-21T00:00:00.000Z',
    },
  };

  const first = await coordinator.mutate(envelope);
  const replay = await coordinator.mutate(envelope);

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(first.value.replayed, false);
  assert.equal(replay.value.replayed, true);
  assert.deepEqual(first.value.result, { id: 'media-1', deleted: true });
  assert.deepEqual(replay.value.result, first.value.result);
  assert.equal(objectDeletes, 1);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM visit_media').get().count,
    0,
  );
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS count FROM atlas_mutation_receipts')
      .get().count,
    1,
  );
});

function toD1(database) {
  function prepare(sql) {
    return bindable(sql, []);
  }
  function bindable(sql, values) {
    return {
      _run() {
        const result = database.prepare(sql).run(...values);
        return { meta: { changes: result.changes }, results: [] };
      },
      bind(...nextValues) {
        return bindable(sql, nextValues);
      },
      async run() {
        return this._run();
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
        const results = statements.map((statement) => statement._run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
