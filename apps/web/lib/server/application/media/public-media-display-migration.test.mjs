import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migrationRoot = new URL(
  '../../../../migrations/owner-poc/',
  import.meta.url,
);
const gateTable = 'owner_poc_public_media_migration_gate_0005';
const migration = await readFile(
  new URL('0005_public_media_display_id.sql', migrationRoot),
  'utf8',
);

void test('public media migration uses no TEMP schema unsupported by D1', () => {
  assert.doesNotMatch(migration, /\bTEMP(?:ORARY)?\b/iu);
});

void test('public media migration adds a unique required display_id to an empty owner database', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(
    await readFile(new URL('0001_owner_poc_schema.sql', migrationRoot), 'utf8'),
  );
  applyMigrationAtomically(database, migration);

  const columns = database.prepare('PRAGMA table_info(visit_media)').all();
  assert.equal(
    columns.some((column) => column.name === 'display_id'),
    true,
  );
  assert.throws(
    () =>
      database.exec(`INSERT INTO visit_media (
      id, visit_id, item_id, object_key, original_filename, content_type,
      byte_size, content_sha256, display_order, created_at, updated_at
    ) VALUES ('m', 'v', 'i', 'key', 'private.jpg', 'image/jpeg', 1,
      'hash', 0, 'now', 'now')`),
    /display_id is required/u,
  );
  assertNoGateTable(database);
  database.close();
});

void test('public media migration fails closed before altering a database with legacy media', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(
    await readFile(new URL('0001_owner_poc_schema.sql', migrationRoot), 'utf8'),
  );
  database.exec(`INSERT INTO visit_media (
    id, visit_id, item_id, object_key, original_filename, content_type,
    byte_size, content_sha256, display_order, created_at, updated_at
  ) VALUES ('internal-media', 'v', 'i', 'private-key', 'private.jpg',
    'image/jpeg', 1, 'hash', 0, 'now', 'now')`);

  assert.throws(
    () => applyMigrationAtomically(database, migration),
    /CHECK constraint failed/u,
  );
  const columns = database.prepare('PRAGMA table_info(visit_media)').all();
  assert.equal(
    columns.some((column) => column.name === 'display_id'),
    false,
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM visit_media').get().count,
    1,
  );
  assertNoGateTable(database);
  database.close();
});

function applyMigrationAtomically(database, sql) {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(sql);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function assertNoGateTable(database) {
  const persistent = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(gateTable);
  const temporary = database
    .prepare(
      `SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name = ?`,
    )
    .get(gateTable);
  assert.equal(persistent, undefined);
  assert.equal(temporary, undefined);
}
