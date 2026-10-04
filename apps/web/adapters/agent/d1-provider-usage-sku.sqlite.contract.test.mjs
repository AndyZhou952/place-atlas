import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { D1ProviderUsage } from './d1-provider-usage.ts';

const legacyMigrationUrl = new URL(
  '../../migrations/agent-poc/0003_agent_provider_usage.sql',
  import.meta.url,
);
const skuMigrationUrl = new URL(
  '../../migrations/owner-poc/0004_provider_usage_skus.sql',
  import.meta.url,
);

void test('SKU migration preserves legacy usage once and separates geocoding requests from walking elements', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(legacyMigrationUrl, 'utf8'));
  database.exec(
    `INSERT INTO agent_provider_usage (
       provider_id, period_start_utc, request_count, cost_micro_usd
     ) VALUES ('google-maps-platform', '2026-09-01T00:00:00.000Z', 2, 10000)`,
  );
  const migration = await readFile(skuMigrationUrl, 'utf8');
  database.exec(migration);
  database.exec(migration);

  assert.deepEqual(
    database
      .prepare(
        `SELECT sku, request_count, billable_units, cost_micro_usd
         FROM agent_provider_usage_by_sku
         WHERE provider_id = 'google-maps-platform'
         ORDER BY sku`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        sku: 'legacy.requests',
        request_count: 2,
        billable_units: 2,
        cost_micro_usd: 10000,
      },
    ],
  );

  database.exec(
    `INSERT INTO agent_provider_usage_by_sku (
       provider_id, sku, period_start_utc, request_count, billable_units,
       cost_micro_usd
     ) VALUES (
       'google-maps-platform', 'geocoding.requests',
       '2026-09-01T00:00:00.000Z', 7999, 7999, 0
     )`,
  );
  const usage = new D1ProviderUsage(
    toD1(database),
    () => new Date('2026-09-17T12:00:00.000Z'),
  );
  assert.equal(await reserve(usage, 'geocoding.requests', 1, 8000), 'reserved');
  assert.equal(
    await reserve(usage, 'geocoding.requests', 1, 8000),
    'quota_exceeded',
  );
  assert.equal(
    await reserve(usage, 'walking_matrix.elements', 7995, 8000),
    'reserved',
  );
  assert.equal(
    await reserve(usage, 'walking_matrix.elements', 5, 8000),
    'reserved',
  );
  assert.equal(
    await reserve(usage, 'walking_matrix.elements', 1, 8000),
    'quota_exceeded',
  );

  assert.deepEqual(
    database
      .prepare(
        `SELECT sku, request_count, billable_units
         FROM agent_provider_usage_by_sku
         WHERE provider_id = 'google-maps-platform'
           AND sku != 'legacy.requests'
         ORDER BY sku`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { sku: 'geocoding.requests', request_count: 8000, billable_units: 8000 },
      {
        sku: 'walking_matrix.elements',
        request_count: 2,
        billable_units: 8000,
      },
    ],
  );
});

void test('concurrent billable-element reservations cannot cross the per-SKU cap', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(legacyMigrationUrl, 'utf8'));
  database.exec(await readFile(skuMigrationUrl, 'utf8'));
  const usage = new D1ProviderUsage(
    toD1(database),
    () => new Date('2026-09-17T12:00:00.000Z'),
  );
  const results = await Promise.all([
    reserve(usage, 'walking_matrix.elements', 5, 8),
    reserve(usage, 'walking_matrix.elements', 5, 8),
  ]);

  assert.deepEqual(
    results.sort((left, right) => left.localeCompare(right)),
    ['quota_exceeded', 'reserved'],
  );
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT request_count, billable_units
         FROM agent_provider_usage_by_sku
         WHERE provider_id = 'google-maps-platform'
           AND sku = 'walking_matrix.elements'`,
        )
        .get(),
    },
    { request_count: 1, billable_units: 5 },
  );
});

function reserve(usage, sku, units, hardUnitLimit) {
  return usage.reserve({
    providerId: 'google-maps-platform',
    sku,
    units,
    requests: 1,
    costUsd: 0.005 * units,
    hardRequestLimit: 8000,
    hardUnitLimit,
    hardCostLimitUsd: 1000,
  });
}

function toD1(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          return {
            async run() {
              return { meta: { changes: statement.run(...values).changes } };
            },
            async first() {
              return statement.get(...values) ?? null;
            },
          };
        },
      };
    },
  };
}
