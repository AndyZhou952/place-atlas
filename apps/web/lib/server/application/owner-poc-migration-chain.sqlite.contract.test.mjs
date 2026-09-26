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
];

test('owner-poc append-only 0001-0010 chain replays from two empty databases', async () => {
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
    ]) {
      assert.ok(tables.includes(required), required);
    }
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM atlas_items').get().count,
      5,
    );
    assert.equal(
      database
        .prepare(
          'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1',
        )
        .get().revision_number,
      1,
    );
  }
});
