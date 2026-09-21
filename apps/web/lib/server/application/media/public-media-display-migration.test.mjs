import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const migrationRoot = new URL(
  '../../../../../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/',
  import.meta.url,
);

void test('public media migration adds a unique required display_id to an empty owner database', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(
    await readFile(new URL('0001_owner_poc_schema.sql', migrationRoot), 'utf8'),
  );
  database.exec(
    await readFile(
      new URL('0005_public_media_display_id.sql', migrationRoot),
      'utf8',
    ),
  );

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
    () => database.exec(awaitMigration),
    /CHECK constraint failed/u,
  );
  const columns = database.prepare('PRAGMA table_info(visit_media)').all();
  assert.equal(
    columns.some((column) => column.name === 'display_id'),
    false,
  );
  database.close();
});

const awaitMigration = await readFile(
  new URL('0005_public_media_display_id.sql', migrationRoot),
  'utf8',
);
