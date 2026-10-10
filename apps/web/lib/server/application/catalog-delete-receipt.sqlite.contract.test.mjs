import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { deleteAtlasItemResponse } from '../../../app/api/destructive-responses.ts';
import { createD1OwnerPocCatalogRead } from '../../../adapters/agent/d1-owner-poc-catalog.ts';
import { createBrowserAtlasApplication } from '../../../features/atlas/atlas-api-client.ts';
import {
  createAtlasViewModelState,
  reduceAtlasViewModelState,
} from '../../../features/atlas/atlas-view-model-state.ts';
import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createCatalogItemProjection } from '../../../product/application/catalog/catalog-item-projection.ts';
import { createDestructiveOperationGroup } from '../../../product/application/destructive/destructive-operations.ts';
import { createInvocationCoordinator } from '../../../product/application/invocation/invocation-coordinator.ts';
import { createVisitTargetProjection } from '../../../product/application/visits/visit-item-projection.ts';
import { D1DestructiveState } from './d1-destructive-state.ts';
import { D1MutationReceiptState } from './d1-mutation-receipt-state.ts';

const root = new URL('../../../migrations/owner-poc/', import.meta.url);
const timestamp = '2026-10-10T00:00:00.000Z';
const deletedTables = [
  'atlas_items',
  'atlas_item_overrides',
  'place_assessments',
  'visits',
  'visit_media',
  'journal_entries',
  'atlas_place_identities',
  'atlas_item_location_snapshots',
  'atlas_item_tabelog_snapshots',
  'atlas_item_reservation_snapshots',
  'atlas_google_rating_references',
];

test('owner restaurant deletion removes the aggregate, refreshes the catalog, and safely replays a lost response', async (t) => {
  const harness = await createHarness(t);
  const { sqlite, catalog, coordinator } = harness;
  const before = await catalog.list('verified_catalog');
  assert.equal(before.length, 2);
  const browser = createBrowserAtlasApplication({
    async request(url, init) {
      return deleteAtlasItemResponse(
        coordinator,
        new Request(`https://atlas.example${url}`, init),
        'remove-me',
      );
    },
  });
  const operation = {
    key: 'catalog.delete_item',
    input: { id: 'remove-me' },
    mutationId: 'remove-restaurant',
  };
  const first = await browser.execute(operation);
  const replay = await browser.execute(operation);
  assert.deepEqual(first, { id: 'remove-me', deleted: true });
  assert.deepEqual(replay, first);
  assert.deepEqual(harness.objectDeletes, ['visits/remove-me/photo']);
  for (const table of deletedTables) {
    assert.equal(
      count(sqlite, table),
      1,
      `${table} preserves only the other restaurant`,
    );
  }
  assert.equal(count(sqlite, 'atlas_mutation_receipts'), 1);
  assert.equal(count(sqlite, 'atlas_item_tombstones'), 1);
  assert.equal(
    sqlite.prepare('SELECT revision_number FROM atlas_catalog_revision').get()
      .revision_number,
    2,
  );
  assert.equal(await catalog.get('remove-me'), undefined);
  const refreshed = await catalog.list('full_merged_catalog');
  assert.deepEqual(
    refreshed.map(({ id }) => id),
    ['keep-me'],
  );
  assert.deepEqual(
    (await catalog.list('verified_catalog')).map(({ id }) => id),
    ['keep-me'],
  );

  // Both the map and table derive their restaurants from this shared state.
  let state = createAtlasViewModelState({
    items: before,
    visits: [],
    media: [],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'item.removed',
    itemId: first.id,
  });
  assert.deepEqual(
    state.items.map(({ id }) => id),
    ['keep-me'],
  );

  const missing = await coordinator.mutate(envelope('missing', 'remove-me'));
  assert.equal(missing.ok, false);
  assert.equal(missing.error.kind, 'not_found');
  const conflict = await coordinator.mutate(
    envelope('remove-restaurant', 'keep-me'),
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.kind, 'conflict');
  assert.equal((await catalog.get('keep-me')).id, 'keep-me');
});

test('a failed restaurant deletion rolls back every row, tombstone, revision, and receipt before deleting objects', async (t) => {
  const harness = await createHarness(t);
  const { sqlite, catalog, coordinator } = harness;
  sqlite.exec(`CREATE TRIGGER reject_delete_receipt BEFORE INSERT ON atlas_mutation_receipts
    BEGIN SELECT RAISE(ABORT, 'simulated receipt failure'); END;`);
  const failed = await coordinator.mutate(
    envelope('retry-delete', 'remove-me'),
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.error.kind, 'dependency_failure');
  for (const table of deletedTables)
    assert.equal(count(sqlite, table), 2, table);
  assert.equal(count(sqlite, 'atlas_item_tombstones'), 0);
  assert.equal(count(sqlite, 'atlas_mutation_receipts'), 0);
  assert.equal(
    sqlite.prepare('SELECT revision_number FROM atlas_catalog_revision').get()
      .revision_number,
    1,
  );
  assert.deepEqual(harness.objectDeletes, []);
  assert.equal((await catalog.get('remove-me')).id, 'remove-me');
  sqlite.exec('DROP TRIGGER reject_delete_receipt');
  const retried = await coordinator.mutate(
    envelope('retry-delete', 'remove-me'),
  );
  assert.equal(retried.ok, true, JSON.stringify(retried));
});

function envelope(mutationId, id) {
  return {
    operation: 'catalog.delete_item',
    input: { id },
    mutationId,
    invocation: {
      principal: 'owner',
      channel: 'web',
      scopes: ['atlas:owner'],
      requestedAt: timestamp,
    },
  };
}

async function createHarness(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  // Apply the actual schema to a disposable database, without importing catalog seeds.
  for (const filename of (await readdir(root))
    .filter((name) => name.endsWith('.sql') && !/^000[23]_/u.test(name))
    .sort()) {
    sqlite.exec(await readFile(new URL(filename, root), 'utf8'));
  }
  for (const id of ['remove-me', 'keep-me']) seedRestaurant(sqlite, id);
  const database = toD1(sqlite);
  const objectDeletes = [];
  const application = createAtlasApplication(
    createDestructiveOperationGroup(
      new D1DestructiveState(database),
      createCatalogItemProjection([]),
      createVisitTargetProjection([]),
      {
        async delete(key) {
          objectDeletes.push(key);
          throw new Error('simulated object cleanup failure');
        },
      },
      { clock: { now: () => timestamp } },
    ),
  );
  return {
    sqlite,
    objectDeletes,
    catalog: createD1OwnerPocCatalogRead(database),
    coordinator: createInvocationCoordinator({
      application,
      receipts: new D1MutationReceiptState(database),
    }),
  };
}

function seedRestaurant(sqlite, id) {
  const item = {
    id,
    kind: 'food',
    title: id,
    area: 'Tokyo',
    address: 'Tokyo',
    description: 'Test restaurant',
    latitude: 35.68,
    longitude: 139.76,
    verificationStatus: 'verified',
    verifiedAt: timestamp,
    reservation: { mode: 'unknown', label: 'Unknown', checkedAt: timestamp },
    personalState: 'saved',
    tags: [],
    sources: [],
  };
  sqlite
    .prepare(`INSERT INTO atlas_items VALUES (?, ?, 'verified', ?, ?)`)
    .run(id, JSON.stringify(item), timestamp, timestamp);
  sqlite
    .prepare(
      `INSERT INTO atlas_item_overrides VALUES (?, ?, 'Description', 'saved', ?)`,
    )
    .run(id, id, timestamp);
  sqlite
    .prepare(
      `INSERT INTO place_assessments (item_id, created_at, updated_at) VALUES (?, ?, ?)`,
    )
    .run(id, timestamp, timestamp);
  sqlite
    .prepare(
      `INSERT INTO visits (id, item_id, item_title, visited_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, id, id, timestamp, timestamp, timestamp);
  sqlite
    .prepare(`INSERT INTO visit_media (id, display_id, visit_id, item_id, object_key, original_filename, content_type, byte_size, content_sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'photo.jpg', 'image/jpeg', 3, ?, ?, ?)`)
    .run(
      id,
      `display-${id}`,
      id,
      id,
      `visits/${id}/photo`,
      'a'.repeat(64),
      timestamp,
      timestamp,
    );
  sqlite
    .prepare(`INSERT INTO journal_entries VALUES (?, ?, ?, ?, 4, 'Note', ?)`)
    .run(id, id, id, timestamp, timestamp);
  sqlite
    .prepare(`INSERT INTO atlas_place_identities VALUES ('test', ?, ?, ?, 0)`)
    .run(id, id, 'a'.repeat(64));
  for (const table of [
    'atlas_item_location_snapshots',
    'atlas_item_tabelog_snapshots',
    'atlas_item_reservation_snapshots',
  ]) {
    sqlite.prepare(`INSERT INTO ${table} VALUES (?, '{}', 0)`).run(id);
  }
  sqlite
    .prepare(`INSERT INTO atlas_google_rating_references VALUES (?, '{}', ?)`)
    .run(id, timestamp);
}

function count(sqlite, table) {
  return sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function toD1(database) {
  function bindable(sql, values = []) {
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
    prepare: bindable,
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
