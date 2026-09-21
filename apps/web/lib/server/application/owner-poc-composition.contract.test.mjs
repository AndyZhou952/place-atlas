import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createPlaceAssessmentOperationGroup } from '../../../product/application/assessments/place-assessment-operations.ts';
import { createCatalogReadOperationGroup } from '../../../product/application/catalog/catalog-operations.ts';
import { createOwnerPocComposition } from './owner-poc-composition.ts';

const ownerRoot = new URL(
  '../../../../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/',
  import.meta.url,
);

const cases = [
  {
    name: 'an empty canonical catalog',
    migrate: ['0001_owner_poc_schema.sql'],
    arrange() {},
    expectedCount: 0,
  },
  {
    name: 'a deleted canonical row',
    migrate: [
      '0001_owner_poc_schema.sql',
      '0002_owner_poc_catalog_seed.sql',
      '0003_copy_legacy_catalog.sql',
    ],
    arrange(database) {
      database.exec(
        `DELETE FROM atlas_items
         WHERE id = (SELECT id FROM atlas_items ORDER BY id LIMIT 1)`,
      );
    },
    expectedCount: 4,
  },
  {
    name: 'a tampered canonical payload',
    migrate: [
      '0001_owner_poc_schema.sql',
      '0002_owner_poc_catalog_seed.sql',
      '0003_copy_legacy_catalog.sql',
    ],
    arrange(database) {
      database.exec(
        `UPDATE atlas_items
         SET payload_json = json_set(payload_json, '$.id', 'tampered-id')
         WHERE id = (SELECT id FROM atlas_items ORDER BY id LIMIT 1)`,
      );
    },
    expectedCount: 4,
  },
  {
    name: 'the normal canonical seed',
    migrate: [
      '0001_owner_poc_schema.sql',
      '0002_owner_poc_catalog_seed.sql',
      '0003_copy_legacy_catalog.sql',
    ],
    arrange() {},
    expectedCount: 5,
  },
];

for (const scenario of cases) {
  void test(`owner-poc Web and Agent share ${scenario.name}`, async () => {
    const sqlite = new DatabaseSync(':memory:');
    for (const migration of scenario.migrate) {
      sqlite.exec(await readFile(new URL(migration, ownerRoot), 'utf8'));
    }
    scenario.arrange(sqlite);
    const database = toD1(sqlite);

    const webComposition = createOwnerPocComposition(database);
    const webApplication = createAtlasApplication(
      createCatalogReadOperationGroup(webComposition.catalogRead),
    );
    const webResult = await webApplication.execute({
      key: 'catalog.list',
      input: { profile: 'full_merged_catalog' },
    });
    const agentCatalog = await createOwnerPocComposition(
      database,
    ).catalogRead.list('full_merged_catalog');

    assert.equal(webResult.ok, true);
    const webCatalog = webResult.ok ? webResult.value : [];
    assert.equal(webCatalog.length, scenario.expectedCount);
    assert.deepEqual(
      webCatalog.map(({ id }) => id),
      agentCatalog.map(({ id }) => id),
    );
    assert.equal(
      agentCatalog.some(({ id }) => id === 'tampered-id'),
      false,
    );
  });
}

void test('owner-poc mutation lookup does not fall back to a missing static seed row', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    await readFile(new URL('0001_owner_poc_schema.sql', ownerRoot), 'utf8'),
  );
  const composition = createOwnerPocComposition(toD1(sqlite));
  let stateReads = 0;
  const application = createAtlasApplication(
    createPlaceAssessmentOperationGroup(
      composition.catalogRead,
      {
        async read() {
          stateReads += 1;
          return { visitCount: 0 };
        },
        async save() {
          throw new Error('must not save a missing canonical row');
        },
      },
      { clock: { now: () => '2026-09-21T00:00:00.000Z' } },
    ),
  );

  const result = await application.execute({
    key: 'assessment.update',
    input: {
      itemId: 'koffee-mameya-kakeru',
      patch: { isFavorite: true },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'not_found');
  assert.equal(stateReads, 0);
});

void test('owner-poc composition uses canonical catalog and Personal Memory instead of poisoned legacy Agent fixtures', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    await readFile(new URL('0001_owner_poc_schema.sql', ownerRoot), 'utf8'),
  );
  const canonical = {
    id: 'canonical-place',
    kind: 'food',
    title: 'Canonical title',
    area: 'Ginza',
    address: 'Canonical address',
    description: 'Canonical description',
    latitude: 35.671,
    longitude: 139.765,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-21T00:00:00.000Z',
    reservation: {
      mode: 'unknown',
      label: 'Canonical reservation',
      checkedAt: '2026-09-21T00:00:00.000Z',
    },
    personalState: 'candidate',
    tags: [],
    sources: [],
  };
  const poisonedLegacy = {
    ...canonical,
    title: 'POISONED LEGACY TITLE',
    address: 'POISONED LEGACY ADDRESS',
    personalRating: 1,
    hasVisited: false,
  };
  const legacyOnly = {
    ...poisonedLegacy,
    id: 'legacy-only-place',
    title: 'POISONED LEGACY ONLY',
  };

  sqlite
    .prepare(
      `INSERT INTO atlas_items (
        id, payload_json, verification_status, created_at, updated_at
      ) VALUES (?, ?, 'verified', ?, ?)`,
    )
    .run(
      canonical.id,
      JSON.stringify(canonical),
      '2026-09-21T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
    );
  const insertLegacy = sqlite.prepare(
    `INSERT INTO agent_catalog_items (
      id, kind, verification_status, latitude, longitude, payload_json,
      record_origin, created_at, updated_at
    ) VALUES (?, 'food', 'verified', ?, ?, ?, 'catalog_intake', ?, ?)`,
  );
  for (const legacy of [poisonedLegacy, legacyOnly]) {
    insertLegacy.run(
      legacy.id,
      legacy.latitude,
      legacy.longitude,
      JSON.stringify(legacy),
      '2026-09-21T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
    );
  }
  sqlite
    .prepare(
      `INSERT INTO agent_nearby_fixtures (
        fixture_set, fixture_rank, resolved_location, item_id, name, area,
        address, walking_minutes, visited, reason, map_deep_link
      ) VALUES ('default', 1, 'POISONED LOCATION', ?, 'POISONED FIXTURE',
                'POISONED AREA', 'POISONED FIXTURE ADDRESS', 1, 0,
                'POISONED REASON', 'https://poison.invalid')`,
    )
    .run(canonical.id);
  sqlite
    .prepare(
      `INSERT INTO place_assessments (
        item_id, overall_rating, is_favorite, has_visited, summary,
        created_at, updated_at
      ) VALUES (?, 4.75, 1, 1, 'Canonical assessment', ?, ?)`,
    )
    .run(canonical.id, '2026-09-21T01:00:00.000Z', '2026-09-21T01:00:00.000Z');
  const insertVisit = sqlite.prepare(
    `INSERT INTO visits (
      id, item_id, item_title, visited_at, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
  );
  for (const [id, visitedAt] of [
    ['visit-older', '2026-09-19T12:00:00.000Z'],
    ['visit-latest', '2026-09-20T12:00:00.000Z'],
  ]) {
    insertVisit.run(
      id,
      canonical.id,
      canonical.title,
      visitedAt,
      visitedAt,
      visitedAt,
    );
  }

  const composition = createOwnerPocComposition(toD1(sqlite));
  const catalog = await composition.catalogRead.list('verified_catalog');
  const facts = await composition.agentNearby.personalFacts.read(canonical.id);

  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, canonical.id);
  assert.equal(catalog[0].title, canonical.title);
  assert.equal(catalog[0].address, canonical.address);
  assert.equal(catalog[0].personalRating, 4.75);
  assert.equal(catalog[0].isFavorite, true);
  assert.equal(catalog[0].hasVisited, true);
  assert.equal(
    catalog.some(({ id }) => id === legacyOnly.id),
    false,
  );
  assert.deepEqual(facts, {
    manualVisited: true,
    visitCount: 2,
    latestVisitAt: '2026-09-20T12:00:00.000Z',
    personalRating: 4.75,
  });
  assert.doesNotMatch(JSON.stringify({ catalog, facts }), /POISONED/u);
});

function toD1(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        async all() {
          return { results: statement.all() };
        },
        bind(...values) {
          return {
            async all() {
              return { results: statement.all(...values) };
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
