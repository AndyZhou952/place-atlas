import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  createAtlasApplication,
  defineOperationGroup,
} from '../../../product/application/atlas-application.ts';
import { createInvocationCoordinator } from '../../../product/application/invocation/invocation-coordinator.ts';
import { success } from '../../../product/application/result.ts';
import { createCatalogOperationGroup } from '../../../product/application/catalog/catalog-operations.ts';
import { createD1OwnerPocCatalogRead } from '../../../adapters/agent/d1-owner-poc-catalog.ts';
import { D1CatalogState } from './d1-catalog-state.ts';
import {
  commitD1MutationAtomically,
  D1MutationReceiptState,
} from './d1-mutation-receipt-state.ts';

const migrationUrl = new URL(
  '../../../migrations/owner-poc/0001_owner_poc_schema.sql',
  import.meta.url,
);
const catalogPublicationMigrationUrl = new URL(
  '../../../migrations/owner-poc/0008_catalog_intake_publication.sql',
  import.meta.url,
);
const invocation = {
  principal: 'owner',
  channel: 'web',
  scopes: ['atlas:owner'],
  requestedAt: '2026-09-21T00:00:00.000Z',
};

void test('catalog item edits commit the override and mutation receipt together', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migrationUrl, 'utf8'));
  sqlite.exec(await readFile(catalogPublicationMigrationUrl, 'utf8'));
  const original = {
    id: 'verve-test',
    kind: 'food',
    title: 'Verve Coffee',
    area: 'Roppongi',
    address: 'Tokyo address',
    description: 'Original description',
    latitude: 35.66,
    longitude: 139.73,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-27',
    reservation: { mode: 'unknown', label: 'Unknown', checkedAt: '2026-09-27' },
    personalState: 'saved',
    tags: [],
    sources: [],
  };
  sqlite
    .prepare(
      `INSERT INTO atlas_items
      (id, payload_json, verification_status, created_at, updated_at)
      VALUES (?, ?, 'verified', ?, ?)`,
    )
    .run(
      original.id,
      JSON.stringify(original),
      invocation.requestedAt,
      invocation.requestedAt,
    );
  const database = toD1(sqlite);
  const application = createAtlasApplication(
    createCatalogOperationGroup(createD1OwnerPocCatalogRead(database), {
      state: new D1CatalogState(database),
      clock: { now: () => '2026-09-27T01:00:00.000Z' },
    }),
  );
  const coordinator = createInvocationCoordinator({
    application,
    receipts: new D1MutationReceiptState(database),
  });
  const input = {
    id: original.id,
    title: original.title,
    description: '主营咖啡馆。位于港区六本木。',
    personalState: 'saved',
  };
  const first = await coordinator.mutate({
    operation: 'catalog.update_item',
    input,
    mutationId: 'edit-verve',
    invocation,
  });
  const replay = await coordinator.mutate({
    operation: 'catalog.update_item',
    input,
    mutationId: 'edit-verve',
    invocation,
  });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.value.replayed, false);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.replayed, true);
  assert.equal(rows(sqlite, 'atlas_mutation_receipts').length, 1);
  assert.equal(rows(sqlite, 'atlas_item_overrides').length, 1);
  assert.equal(
    sqlite
      .prepare('SELECT description FROM atlas_item_overrides WHERE item_id = ?')
      .get(original.id).description,
    input.description,
  );
  const read = await application.execute({
    key: 'catalog.get',
    input: { id: original.id },
  });
  assert.equal(read.ok, true);
  assert.equal(read.value.description, input.description);
});

void test('normalized payload replay is stable and a different payload conflicts', async () => {
  const harness = await createHarness();
  const first = await harness.coordinator.mutate({
    operation: 'example.assign',
    input: { note: ' Cafe\u0301 ', value: ' saved ' },
    mutationId: 'mutation-1',
    invocation,
  });
  const replay = await harness.coordinator.mutate({
    operation: 'example.assign',
    input: { value: 'saved', note: 'Caf\u00e9' },
    mutationId: 'mutation-1',
    invocation: { ...invocation, requestedAt: '2026-09-21T00:01:00.000Z' },
  });
  const conflict = await harness.coordinator.mutate({
    operation: 'example.assign',
    input: { value: 'different' },
    mutationId: 'mutation-1',
    invocation,
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(first.value.replayed, false);
  assert.equal(replay.value.replayed, true);
  assert.equal(first.value.payloadDigest, replay.value.payloadDigest);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.kind, 'conflict');
  assert.deepEqual(rows(harness.sqlite, 'assignments'), [
    { value: 'saved', note: 'Caf\u00e9' },
  ]);
  assert.equal(rows(harness.sqlite, 'atlas_mutation_receipts').length, 1);
  assert.equal(harness.validationCount(), 3);
});

void test('a concurrent same-digest attempt returns in_progress and does not write', async () => {
  const harness = await createHarness({ nowMs: 1_000 });
  const normalized = harness.application.normalize({
    key: 'example.assign',
    input: { value: 'saved' },
  });
  assert.equal(normalized.ok, true);
  const digest = await harness.digestFor('pending-probe', {
    value: 'saved',
    note: '',
  });
  await harness.receipts.claim({
    principal: 'owner',
    mutationId: 'pending-probe',
    payloadDigest: digest,
    attemptToken: 'attempt-held',
    nowMs: 1_000,
    leaseUntilMs: 31_000,
  });

  const pending = await harness.coordinator.mutate({
    operation: 'example.assign',
    input: { value: 'saved' },
    mutationId: 'pending-probe',
    invocation,
  });

  assert.equal(pending.ok, false);
  assert.equal(pending.error.kind, 'in_progress');
  assert.deepEqual(rows(harness.sqlite, 'assignments'), []);
});

void test('an expired lease is taken over and stable input commits once', async () => {
  const harness = await createHarness({ nowMs: 40_000 });
  const digest = await harness.digestFor('takeover', {
    value: 'saved',
    note: '',
  });
  await harness.receipts.claim({
    principal: 'owner',
    mutationId: 'takeover',
    payloadDigest: digest,
    attemptToken: 'crashed-attempt',
    nowMs: 1_000,
    leaseUntilMs: 31_000,
  });

  const recovered = await harness.coordinator.mutate({
    operation: 'example.assign',
    input: { value: 'saved' },
    mutationId: 'takeover',
    invocation,
  });

  assert.equal(recovered.ok, true);
  assert.equal(recovered.value.replayed, false);
  assert.deepEqual(rows(harness.sqlite, 'assignments'), [
    { value: 'saved', note: '' },
  ]);
});

void test('a stale attempt cannot commit a business row without its final receipt', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migrationUrl, 'utf8'));
  sqlite.exec(
    'CREATE TABLE assignments (value TEXT NOT NULL, note TEXT NOT NULL)',
  );
  const database = toD1(sqlite);
  const receipts = new D1MutationReceiptState(database);
  const base = {
    principal: 'owner',
    mutationId: 'stale-attempt',
    payloadDigest: 'a'.repeat(64),
  };
  await receipts.claim({
    ...base,
    attemptToken: 'attempt-old',
    nowMs: 1_000,
    leaseUntilMs: 2_000,
  });
  await receipts.claim({
    ...base,
    attemptToken: 'attempt-new',
    nowMs: 3_000,
    leaseUntilMs: 33_000,
  });

  await assert.rejects(
    commitD1MutationAtomically(
      database,
      [
        database
          .prepare('INSERT INTO assignments (value, note) VALUES (?, ?)')
          .bind('must-rollback', ''),
      ],
      {
        ...base,
        attemptToken: 'attempt-old',
        result: { saved: true },
        committedAtMs: 3_001,
      },
    ),
  );
  assert.deepEqual(rows(sqlite, 'assignments'), []);
  assert.deepEqual(rows(sqlite, 'atlas_mutation_receipts'), []);
});

void test('a successful handler that does not atomically finalize fails closed', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migrationUrl, 'utf8'));
  const database = toD1(sqlite);
  const application = createAtlasApplication(
    defineOperationGroup({
      'example.unfinalized': {
        descriptor: {
          key: 'example.unfinalized',
          resultKind: 'json',
          effect: 'write',
          validate: () => success({}),
        },
        async handle() {
          return success({ saved: true });
        },
      },
    }),
  );
  const coordinator = createInvocationCoordinator({
    application,
    receipts: new D1MutationReceiptState(database),
    clock: { nowMs: () => 1_000 },
    attemptToken: () => 'unfinalized-attempt',
  });

  const result = await coordinator.mutate({
    operation: 'example.unfinalized',
    input: {},
    mutationId: 'unfinalized',
    invocation,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'dependency_failure');
  assert.deepEqual(rows(sqlite, 'atlas_mutation_receipts'), []);
  assert.deepEqual(
    rows(sqlite, 'atlas_mutation_claims').map(({ state }) => ({ state })),
    [{ state: 'claimed' }],
  );
});

async function createHarness(options = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migrationUrl, 'utf8'));
  sqlite.exec(
    'CREATE TABLE assignments (value TEXT NOT NULL, note TEXT NOT NULL)',
  );
  const database = toD1(sqlite);
  let validationCount = 0;
  const definitions = defineOperationGroup({
    'example.assign': {
      descriptor: {
        key: 'example.assign',
        resultKind: 'json',
        effect: 'write',
        validate(input) {
          validationCount += 1;
          const value = Reflect.get(input, 'value');
          const note = Reflect.get(input, 'note');
          return success({
            value: String(value).trim(),
            note: typeof note === 'string' ? note.trim().normalize('NFC') : '',
          });
        },
      },
      async handle(input, execution) {
        const result = { saved: input };
        await commitD1MutationAtomically(
          database,
          [
            database
              .prepare('INSERT INTO assignments (value, note) VALUES (?, ?)')
              .bind(input.value, input.note),
          ],
          execution?.atomicMutation?.receiptFor(result),
        );
        return success(result);
      },
    },
  });
  const application = createAtlasApplication(definitions);
  const receipts = new D1MutationReceiptState(database);
  const nowMs = options.nowMs ?? 1_000;
  let attempt = 0;
  return {
    sqlite,
    application,
    receipts,
    validationCount: () => validationCount,
    coordinator: createInvocationCoordinator({
      application,
      receipts,
      clock: { nowMs: () => nowMs },
      attemptToken: () => `attempt-${++attempt}`,
    }),
    async digestFor(mutationId, normalizedInput) {
      const probe = createInvocationCoordinator({
        application,
        receipts: {
          async claim(candidate) {
            return {
              kind: 'replay',
              receipt: {
                mutationId,
                payloadDigest: candidate.payloadDigest,
                result: {},
              },
            };
          },
          async readFinal() {
            return { kind: 'pending' };
          },
          async release() {},
        },
        clock: { nowMs: () => nowMs },
      });
      const result = await probe.mutate({
        operation: 'example.assign',
        input: normalizedInput,
        mutationId,
        invocation,
      });
      assert.equal(result.ok, true);
      return result.value.payloadDigest;
    },
  };
}

function rows(database, table) {
  return database
    .prepare(`SELECT * FROM ${table}`)
    .all()
    .map((row) => ({ ...row }));
}

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
