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
  '0013_personal_rating_ten.sql',
];

test('owner-poc append-only 0001-0013 chain replays from two empty databases', async () => {
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
      0,
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

test('migration replay preserves previously installed catalog records', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(new URL(migrations[0], root), 'utf8'));
  const payload = JSON.stringify({
    id: 'saved-place',
    kind: 'food',
    title: 'Owner saved place',
  });
  database
    .prepare(`INSERT INTO atlas_items (id, payload_json, verification_status, created_at, updated_at)
    VALUES (?, ?, 'verified', 'created', 'updated')`)
    .run('saved-place', payload);
  for (const migration of migrations.slice(1)) {
    database.exec(await readFile(new URL(migration, root), 'utf8'));
  }
  assert.deepEqual(
    database.prepare('SELECT id, payload_json FROM atlas_items').get(),
    Object.assign(Object.create(null), {
      id: 'saved-place',
      payload_json: payload,
    }),
  );
  database.close();
});

test('personal score migration converts to ten, preserves unrelated data, and leaves null unrated', async () => {
  const database = new DatabaseSync(':memory:');
  for (const migration of migrations.filter(
    (name) => !name.startsWith('0013_'),
  )) {
    database.exec(await readFile(new URL(migration, root), 'utf8'));
  }
  const inputs = [0, 1, 2, 3, 3.5, 3.7, 4, 4.2, 4.5, 5, null];
  const expected = [0, 2, 4, 6, 7, 7.5, 8, 8.5, 9, 10, null];
  for (const [index, rating] of inputs.entries()) {
    database
      .prepare(
        `INSERT INTO place_assessments (item_id, overall_rating, is_favorite, has_visited, summary, created_at, updated_at) VALUES (?, ?, 1, 1, 'keep note', 'created', 'updated')`,
      )
      .run(`synthetic-${index}`, rating);
  }
  // Personal score fields are independent of source facts, visits and media.
  database
    .prepare(
      `INSERT INTO atlas_items (id,payload_json,verification_status,created_at,updated_at) VALUES ('source',?, 'verified','created','updated')`,
    )
    .run(
      JSON.stringify({ tabelog: { score: 4.2 }, googleRating: { score: 4.5 } }),
    );
  database.exec(
    `INSERT INTO visits VALUES ('visit','source','Source','2026-10-18','keep visit','created','updated')`,
  );
  const before = database
    .prepare('SELECT * FROM place_assessments ORDER BY item_id')
    .all();
  const sourcesBefore = database.prepare('SELECT * FROM atlas_items').all();
  const visitsBefore = database.prepare('SELECT * FROM visits').all();
  const sql = await readFile(
    new URL('0013_personal_rating_ten.sql', root),
    'utf8',
  );
  database.exec(sql);
  for (const [index, rating] of expected.entries()) {
    assert.equal(
      database
        .prepare(
          'SELECT overall_rating FROM place_assessments WHERE item_id = ?',
        )
        .get(`synthetic-${index}`).overall_rating,
      rating,
    );
  }
  const converted = database
    .prepare('SELECT * FROM place_assessments ORDER BY item_id')
    .all();
  assert.deepEqual(
    converted.map(({ overall_rating: _rating, ...rest }) => rest),
    before.map(({ overall_rating: _rating, ...rest }) => rest),
  );
  assert.deepEqual(
    database.prepare('SELECT * FROM atlas_items').all(),
    sourcesBefore,
  );
  assert.deepEqual(
    database.prepare('SELECT * FROM visits').all(),
    visitsBefore,
  );
});
