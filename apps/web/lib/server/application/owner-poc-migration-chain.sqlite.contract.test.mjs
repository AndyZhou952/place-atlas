import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const root = new URL('../../../migrations/owner-poc/', import.meta.url);
const migrations = [
  '0001_owner_poc_schema.sql',
  '0002_owner_poc_catalog_seed.sql',
  '0003_copy_legacy_catalog.sql',
  '0004_provider_usage_skus.sql',
  '0005_public_media_display_id.sql',
  '0006_catalog_intake_sessions.sql',
  '0007_nominatim_policy_state.sql',
  '0008_catalog_intake_publication.sql',
  '0009_catalog_intake_research_allowances.sql',
  '0010_owner_agent_settings.sql',
  '0011_visit_media_score.sql',
  '0012_google_rating_references.sql',
];

test('owner-poc append-only 0001-0012 chain replays from two empty databases', async () => {
  for (let run = 0; run < 2; run += 1) {
    const database = new DatabaseSync(':memory:');
    for (const migration of migrations) {
      database.exec(await readFile(new URL(migration, root), 'utf8'));
    }
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map(({ name }) => name);
    for (const required of [
      'atlas_items',
      'agent_provider_usage_by_sku',
      'catalog_intake_sessions',
      'catalog_intake_nominatim_cache',
      'atlas_catalog_revision',
      'catalog_intake_publish_receipts',
      'catalog_intake_research_phase_spends',
      'owner_agent_settings',
      'atlas_google_rating_references',
    ]) {
      assert.ok(tables.includes(required), required);
    }
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM atlas_items').get().count,
      5,
    );
    for (const table of [
      'owner_agent_settings',
      'place_assessments',
      'visits',
      'visit_media',
      'atlas_google_rating_references',
    ]) {
      assert.equal(
        database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        0,
        `a fresh deployment must not inherit another Owner's ${table}`,
      );
    }
    assert.equal(
      database
        .prepare(
          'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1',
        )
        .get().revision_number,
      1,
    );
    assert.ok(
      database
        .prepare('PRAGMA table_info(visit_media)')
        .all()
        .some((column) => column.name === 'score'),
    );
  }
});

test('media score migration preserves existing rows and rejects out-of-range values', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(
    await readFile(new URL('0001_owner_poc_schema.sql', root), 'utf8'),
  );
  database.exec(
    await readFile(new URL('0005_public_media_display_id.sql', root), 'utf8'),
  );
  database.exec(`INSERT INTO visit_media
    (id, display_id, visit_id, item_id, object_key, original_filename,
     content_type, byte_size, content_sha256, caption, display_order,
     created_at, updated_at)
    VALUES ('old', 'pm_opaque_old', 'visit', 'place', 'visits/visit/old',
            'old.jpg', 'image/jpeg', 3, 'hash', 'caption', 0, 'created', 'created')`);
  database.exec(
    await readFile(new URL('0011_visit_media_score.sql', root), 'utf8'),
  );
  const oldMedia = database
    .prepare('SELECT caption, score FROM visit_media WHERE id = ?')
    .get('old');
  assert.equal(oldMedia.caption, 'caption');
  assert.equal(oldMedia.score, null);
  database
    .prepare('UPDATE visit_media SET score = ? WHERE id = ?')
    .run(4.3, 'old');
  assert.equal(
    database.prepare('SELECT score FROM visit_media WHERE id = ?').get('old')
      .score,
    4.3,
  );
  assert.throws(
    () =>
      database
        .prepare('UPDATE visit_media SET score = 5.1 WHERE id = ?')
        .run('old'),
    /CHECK constraint failed/u,
  );
  database.close();
});
