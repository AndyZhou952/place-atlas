import { toD1 } from '../test-support/d1.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createD1MeteredRouteSidecarClient } from './d1-metered-route-sidecar-client.ts';

const legacyMigrationUrl = new URL(
  '../migrations/agent-poc/0003_agent_provider_usage.sql',
  import.meta.url,
);
const skuMigrationUrl = new URL(
  '../migrations/owner-poc/0004_provider_usage_skus.sql',
  import.meta.url,
);

void test('D1 metering reserves both 8,000-unit SKUs by UTC month before RPC', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(legacyMigrationUrl, 'utf8'));
  database.exec(await readFile(skuMigrationUrl, 'utf8'));
  database.exec(`
    INSERT INTO agent_provider_usage_by_sku (
      provider_id, sku, period_start_utc, request_count, billable_units,
      cost_micro_usd
    ) VALUES
      ('google-maps-platform', 'geocoding.requests',
       '2026-09-01T00:00:00.000Z', 7999, 7999, 0),
      ('google-maps-platform', 'walking_matrix.elements',
       '2026-09-01T00:00:00.000Z', 1, 7998, 0)
  `);
  let now = new Date('2026-09-30T23:59:59.000Z');
  let geocodeCalls = 0;
  let walkingCalls = 0;
  const client = createD1MeteredRouteSidecarClient({
    database: toD1(database),
    clock: () => now,
    service: {
      async geocode() {
        geocodeCalls += 1;
        return {
          ok: true,
          evidence: {
            candidates: [],
            attribution: {
              label: 'Google Maps',
              url: 'https://www.google.com/maps',
            },
            source: {
              providerId: 'google-maps-platform',
              endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
            },
            checkedAt: now.toISOString(),
          },
        };
      },
      async walkingMatrix(request) {
        walkingCalls += 1;
        return {
          ok: true,
          evidence: {
            routes: request.destinations.map((_, destinationIndex) => ({
              destinationIndex,
              durationSeconds: 60,
              distanceMeters: 100,
            })),
            attribution: {
              label: 'Google Maps',
              url: 'https://www.google.com/maps',
            },
            source: {
              providerId: 'google-maps-platform',
              endpoint:
                'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
            },
            checkedAt: now.toISOString(),
          },
        };
      },
    },
  });

  assert.equal((await client.geocode({ locationHint: '銀座' })).ok, true);
  assert.deepEqual(await client.geocode({ locationHint: 'ginza' }), {
    ok: false,
    error: 'quota_exceeded',
  });
  const matrix = {
    origin: { latitude: 35.67, longitude: 139.76 },
    destinations: [
      { latitude: 35.671, longitude: 139.761 },
      { latitude: 35.672, longitude: 139.762 },
    ],
  };
  assert.equal((await client.walkingMatrix(matrix)).ok, true);
  assert.deepEqual(
    await client.walkingMatrix({
      ...matrix,
      destinations: matrix.destinations.slice(0, 1),
    }),
    { ok: false, error: 'quota_exceeded' },
  );
  assert.deepEqual(
    { geocodeCalls, walkingCalls },
    { geocodeCalls: 1, walkingCalls: 1 },
  );

  now = new Date('2026-10-01T00:00:00.000Z');
  assert.equal((await client.geocode({ locationHint: '銀座' })).ok, true);
  assert.equal((await client.walkingMatrix(matrix)).ok, true);
  assert.deepEqual(
    database
      .prepare(`
        SELECT sku, period_start_utc, request_count, billable_units
        FROM agent_provider_usage_by_sku
        WHERE provider_id = 'google-maps-platform'
          AND period_start_utc = '2026-10-01T00:00:00.000Z'
        ORDER BY sku
      `)
      .all()
      .map((row) => ({ ...row })),
    [
      {
        sku: 'geocoding.requests',
        period_start_utc: '2026-10-01T00:00:00.000Z',
        request_count: 1,
        billable_units: 1,
      },
      {
        sku: 'walking_matrix.elements',
        period_start_utc: '2026-10-01T00:00:00.000Z',
        request_count: 1,
        billable_units: 2,
      },
    ],
  );
});

void test('D1 transit cap blocks the 251st paid request before provider egress', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(legacyMigrationUrl, 'utf8'));
  database.exec(await readFile(skuMigrationUrl, 'utf8'));
  database.exec(`
    INSERT INTO agent_provider_usage_by_sku (
      provider_id, sku, period_start_utc, request_count, billable_units,
      cost_micro_usd
    ) VALUES (
      'google-maps-platform', 'transit_routes.requests',
      '2026-09-01T00:00:00.000Z', 249, 249, 4980000
    )
  `);
  let calls = 0;
  const client = createD1MeteredRouteSidecarClient({
    database: toD1(database),
    clock: () => new Date('2026-09-30T00:00:00.000Z'),
    service: {
      async transit() {
        calls += 1;
        return { ok: true, evidence: { directRoute: null } };
      },
    },
  });
  const request = {
    origin: { latitude: 38.72, longitude: -9.14 },
    destination: { latitude: 38.73, longitude: -9.15 },
  };
  assert.equal((await client.transit(request)).ok, true);
  assert.deepEqual(await client.transit(request), {
    ok: false,
    error: 'quota_exceeded',
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    {
      ...database
        .prepare(`
      SELECT request_count, billable_units, cost_micro_usd
      FROM agent_provider_usage_by_sku
      WHERE sku = 'transit_routes.requests'
    `)
        .get(),
    },
    { request_count: 250, billable_units: 250, cost_micro_usd: 5000000 },
  );
});
