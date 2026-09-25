import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const legacyRoot = new URL('../../migrations/agent-poc/', import.meta.url);
const ownerRoot = new URL('../../migrations/owner-poc/', import.meta.url);

void test('the owner-poc migration chain seeds five canonical records from an empty blue-green database', async () => {
  const database = new DatabaseSync(':memory:');
  for (const name of [
    '0001_owner_poc_schema.sql',
    '0002_owner_poc_catalog_seed.sql',
    '0003_copy_legacy_catalog.sql',
    '0004_provider_usage_skus.sql',
  ]) {
    database.exec(await readFile(new URL(name, ownerRoot), 'utf8'));
  }

  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM agent_catalog_items').get()
      .count,
    5,
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM atlas_items').get().count,
    5,
  );
});

void test('owner-poc migrations preserve legacy Agent state, create the writable Web schema, and idempotently copy the canonical catalog', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(
    await readFile(
      new URL('0001_agent_readonly_fixture.sql', legacyRoot),
      'utf8',
    ),
  );
  database.exec(
    await readFile(new URL('0002_agent_catalog_seed.sql', legacyRoot), 'utf8'),
  );
  database.exec(
    await readFile(
      new URL('0003_agent_provider_usage.sql', legacyRoot),
      'utf8',
    ),
  );
  database.exec(
    `INSERT INTO agent_gateway_audit (
      project_id, key_id, actor_id, channel, conversation_id, operation,
      mutation_id, result_kind, replayed, duration_ms, created_at_ms
    ) VALUES ('jpmap', 'key-v1', 'owner', 'wechat', 'dm', 'agent.nearby',
              'event-1', 'success', 0, 12, 1)`,
  );
  database.exec(
    `INSERT INTO agent_provider_usage (
      provider_id, period_start_utc, request_count, cost_micro_usd
    ) VALUES ('google-maps-platform', '2026-09-01T00:00:00.000Z', 2, 10000)`,
  );

  const schema = await readFile(
    new URL('0001_owner_poc_schema.sql', ownerRoot),
    'utf8',
  );
  const seed = await readFile(
    new URL('0002_owner_poc_catalog_seed.sql', ownerRoot),
    'utf8',
  );
  const canonical = await readFile(
    new URL('0003_copy_legacy_catalog.sql', ownerRoot),
    'utf8',
  );
  const skuUsage = await readFile(
    new URL('0004_provider_usage_skus.sql', ownerRoot),
    'utf8',
  );
  database.exec(schema);
  database.exec(seed);
  database.exec(canonical);
  database.exec(schema);
  database.exec(skuUsage);
  database.exec(seed);
  database.exec(canonical);

  database.exec(skuUsage);
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all()
    .map(({ name }) => name);
  for (const table of [
    'atlas_items',
    'atlas_item_overrides',
    'atlas_item_tombstones',
    'place_assessments',
    'visits',
    'visit_media',
    'journal_entries',
    'import_jobs',
    'maintenance_control',
    'maintenance_write_leases',
    'maintenance_confirmations',
    'maintenance_restore_runs',
    'maintenance_restore_chunks',
    'agent_gateway_nonces',
    'agent_gateway_receipts',
    'agent_gateway_audit',
    'agent_nearby_fixtures',
    'agent_catalog_items',
    'agent_provider_usage',
    'agent_provider_usage_by_sku',
    'owner_poc_seed_manifests',
    'owner_poc_seed_manifest_records',
  ]) {
    assert.ok(tables.includes(table), `missing table ${table}`);
  }
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM agent_catalog_items').get()
      .count,
    5,
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM atlas_items').get().count,
    5,
  );
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM agent_gateway_audit').get()
      .count,
    1,
  );
  const usage = database
    .prepare(
      `SELECT request_count, cost_micro_usd
       FROM agent_provider_usage
       WHERE provider_id = 'google-maps-platform'`,
    )
    .get();
  assert.equal(usage.request_count, 2);
  assert.equal(usage.cost_micro_usd, 10000);
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT sku, request_count, billable_units, cost_micro_usd
           FROM agent_provider_usage_by_sku
           WHERE provider_id = 'google-maps-platform'`,
        )
        .get(),
    },
    {
      sku: 'legacy.requests',
      request_count: 2,
      billable_units: 2,
      cost_micro_usd: 10000,
    },
  );
});
