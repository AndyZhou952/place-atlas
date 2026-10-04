import { toD1 } from '../../../test-support/d1.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { D1NominatimPolicyState } from './d1-nominatim-policy-state.ts';

const migration = new URL(
  '../../../migrations/owner-poc/0007_nominatim_policy_state.sql',
  import.meta.url,
);

test('D1 Nominatim policy state shares one atomic application rate gate and cache across adapters', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  sqlite.exec(await readFile(migration, 'utf8'));
  const database = toD1(sqlite);
  const clock = { now: () => new Date('2026-09-22T10:00:07.000Z') };
  const first = new D1NominatimPolicyState(database, clock);
  const second = new D1NominatimPolicyState(database, clock);
  const now = new Date('2026-09-22T10:00:00.000Z');

  assert.deepEqual(
    await Promise.all([first.reserve(now), second.reserve(now)]),
    [true, false],
  );
  assert.equal(
    await second.reserve(new Date('2026-09-22T10:00:00.999Z')),
    false,
  );
  assert.equal(
    await second.reserve(new Date('2026-09-22T10:00:01.000Z')),
    true,
  );

  const proposal = {
    status: 'resolved',
    normalizedAddress: '東京都中央区銀座4丁目1-2',
    latitude: 35.6717,
    longitude: 139.765,
    provider: 'nominatim.openstreetmap.org',
    sourceUrl: 'https://www.openstreetmap.org/node/456',
    license: 'OpenStreetMap contributors, ODbL 1.0',
    checkedAt: '2026-09-22T10:00:00.000Z',
  };
  await first.set('query-key', proposal);
  assert.deepEqual(await second.get('query-key'), proposal);
  assert.equal(
    sqlite
      .prepare(
        'SELECT cached_at_ms FROM catalog_intake_nominatim_cache WHERE query_key = ?',
      )
      .get('query-key').cached_at_ms,
    clock.now().getTime(),
  );

  sqlite
    .prepare(
      'UPDATE catalog_intake_nominatim_cache SET result_json = ? WHERE query_key = ?',
    )
    .run(
      JSON.stringify({
        status: 'resolved',
        normalizedAddress: '東京都中央区銀座4丁目1-2',
        latitude: 35.6717,
        longitude: 139.765,
        provider: 'nominatim.openstreetmap.org',
        sourceUrl: 'https://www.openstreetmap.org/node/456',
        license: 'OpenStreetMap contributors, ODbL 1.0',
        checkedAt: '2026-09-22T10:00:00.000Z',
        privateNote: 'must not cross the cache seam',
      }),
      'query-key',
    );
  assert.equal(await second.get('query-key'), undefined);

  assert.throws(
    () =>
      sqlite
        .prepare(
          'UPDATE catalog_intake_nominatim_cache SET result_json = ? WHERE query_key = ?',
        )
        .run('{not-json', 'query-key'),
    /json_valid/u,
  );
});

test('D1 Nominatim cache expires stale values and scheduled cleanup removes retained rows', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(migration, 'utf8'));
  let now = new Date('2026-09-24T00:00:00.000Z');
  const state = new D1NominatimPolicyState(toD1(sqlite), { now: () => now });
  const proposal = {
    status: 'resolved',
    normalizedAddress: '東京都中央区銀座4丁目1-2',
    latitude: 35.6717,
    longitude: 139.765,
    provider: 'nominatim.openstreetmap.org',
    sourceUrl: 'https://www.openstreetmap.org/node/456',
    license: 'OpenStreetMap contributors, ODbL 1.0',
    checkedAt: now.toISOString(),
  };
  await state.set('query', proposal);
  assert.deepEqual(await state.get('query'), proposal);

  now = new Date('2026-10-25T00:00:00.000Z');
  assert.equal(await state.get('query'), undefined);
  assert.equal(await state.cleanup(now), 1);
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS count FROM catalog_intake_nominatim_cache')
      .get().count,
    0,
  );
});
