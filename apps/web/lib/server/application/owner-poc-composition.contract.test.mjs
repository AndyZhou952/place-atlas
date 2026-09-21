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
          };
        },
      };
    },
  };
}
