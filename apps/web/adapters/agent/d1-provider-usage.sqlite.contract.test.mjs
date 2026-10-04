import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { D1ProviderUsage } from './d1-provider-usage.ts';

const migrationUrl = new URL(
  '../../migrations/agent-poc/0003_agent_provider_usage.sql',
  import.meta.url,
);

test('the provider usage migration is idempotent and reservations atomically enforce request and micro-USD boundaries', async () => {
  const database = new DatabaseSync(':memory:');
  const migration = await readFile(migrationUrl, 'utf8');
  database.exec(migration);
  database.exec(migration);
  const usage = new D1ProviderUsage(
    toD1(database),
    () => new Date('2026-09-17T12:00:00.000Z'),
  );

  assert.equal(await reserve(usage, 0.005, 2, 0.01), 'reserved');
  assert.equal(await reserve(usage, 0.005, 2, 0.01), 'reserved');
  assert.equal(await reserve(usage, 0, 2, 0.01), 'quota_exceeded');

  const costUsage = new D1ProviderUsage(
    toD1(database),
    () => new Date('2026-09-17T12:00:00.000Z'),
  );
  assert.equal(await reserve(costUsage, 0.007, 10, 0.01), 'reserved');
  assert.equal(await reserve(costUsage, 0.004, 10, 0.01), 'cost_exceeded');
});

test('concurrent reservations cannot both exceed a one-request hard limit and a UTC month starts fresh', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(migrationUrl, 'utf8'));
  let now = new Date('2026-09-30T23:59:59.000Z');
  const usage = new D1ProviderUsage(toD1(database), () => now);
  const results = await Promise.all([
    reserve(usage, 0.001, 1, 1),
    reserve(usage, 0.001, 1, 1),
  ]);
  assert.deepEqual(
    results.sort((left, right) => left.localeCompare(right)),
    ['quota_exceeded', 'reserved'],
  );
  now = new Date('2026-10-01T00:00:00.000Z');
  assert.equal(await reserve(usage, 0.001, 1, 1), 'reserved');
});

test('D1 errors fail closed without a provider request', async () => {
  const usage = new D1ProviderUsage(
    {
      prepare() {
        throw new Error('D1 unavailable');
      },
    },
    () => new Date(),
  );
  assert.equal(await reserve(usage, 0.001, 1, 1), 'cost_exceeded');
});

function reserve(usage, costUsd, hardRequestLimit, hardCostLimitUsd) {
  return usage.reserve({
    providerId: hardRequestLimit === 10 ? 'google-cost' : 'google',
    requests: 1,
    costUsd,
    hardRequestLimit,
    hardCostLimitUsd,
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
