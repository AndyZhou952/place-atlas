import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import {
  createCatalogOperationGroup,
  createCatalogReadOperationGroup,
} from '../../../product/application/catalog/catalog-operations.ts';
import { createCatalogRead } from '../../../product/application/catalog/catalog-read.ts';
import { D1CatalogState } from './d1-catalog-state.ts';

const storedItem = {
  id: 'stored',
  kind: 'food',
  title: 'Stored title',
  area: 'Tokyo',
  address: 'Tokyo address',
  description: 'Stored description',
  latitude: 35.68,
  longitude: 139.76,
  verificationStatus: 'needs_review',
  verifiedAt: '2026-09-01',
  reservation: {
    mode: 'unknown',
    label: 'Unknown',
    checkedAt: '2026-09-01',
  },
  personalState: 'candidate',
  tags: [],
  sources: [],
};

test('the D1 catalog adapter maps record state into the application contract', async () => {
  const database = {
    prepare(sql) {
      return {
        async all() {
          if (/SELECT id, payload_json FROM atlas_items/u.test(sql)) {
            return {
              results: [
                { id: 'stored', payload_json: JSON.stringify(storedItem) },
              ],
            };
          }
          if (/FROM atlas_review_candidates/u.test(sql)) {
            return { results: [] };
          }
          if (/FROM atlas_item_overrides/u.test(sql)) {
            return {
              results: [
                {
                  item_id: 'stored',
                  title: 'Edited title',
                  description: 'Edited description',
                  personal_state: 'saved',
                  updated_at: '2026-09-12T02:00:00.000Z',
                },
              ],
            };
          }
          if (/FROM place_assessments/u.test(sql)) {
            return {
              results: [
                {
                  item_id: 'stored',
                  overall_rating: 4.4,
                  is_favorite: 1,
                  has_visited: 0,
                },
              ],
            };
          }
          if (/FROM atlas_item_tombstones/u.test(sql)) {
            return { results: [] };
          }
          if (/FROM visits GROUP BY item_id/u.test(sql)) {
            return { results: [{ item_id: 'stored', visit_count: 2 }] };
          }
          assert.fail(`Unexpected catalog query: ${sql}`);
        },
      };
    },
  };
  const application = createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(new D1CatalogState(database), []),
    ),
  );

  const result = await application.execute({
    key: 'catalog.list',
    input: { profile: 'full_merged_catalog' },
  });

  assert.deepEqual(result, {
    ok: true,
    value: [
      {
        ...storedItem,
        title: 'Edited title',
        description: 'Edited description',
        personalState: 'saved',
        updatedAt: '2026-09-12T02:00:00.000Z',
        personalRating: 4.4,
        isFavorite: true,
        hasVisited: true,
      },
    ],
  });
});

test('the D1 catalog adapter persists a needs-review item with the application timestamp', async () => {
  const statements = [];
  const database = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
      };
      return statement;
    },
    async batch(next) {
      statements.push(...next);
      return next.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const state = new D1CatalogState(database);
  const application = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(state, []), {
      state,
      clock: { now: () => '2026-09-12T13:00:00.000Z' },
    }),
  );

  const result = await application.execute({
    key: 'catalog.save_discovered',
    input: storedItem,
  });

  assert.equal(result.ok, true);
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /INSERT INTO atlas_items/u);
  assert.match(statements[1].sql, /UPDATE atlas_catalog_revision/u);
  assert.equal(statements[0].values[0], storedItem.id);
  assert.deepEqual(JSON.parse(statements[0].values[1]), {
    ...storedItem,
    updatedAt: '2026-09-12T13:00:00.000Z',
    classification: {
      cuisines: [],
      geography: {
        countryCode: 'JP',
        subdivisionCode: 'JP-13',
        subdivisionName: '東京都',
      },
      basis: { cuisineLabels: [], address: 'Tokyo address' },
    },
  });
  assert.deepEqual(statements[0].values.slice(2), [
    'needs_review',
    '2026-09-12T13:00:00.000Z',
    '2026-09-12T13:00:00.000Z',
  ]);
});

test('the D1 catalog adapter upserts the complete item override record', async () => {
  const statements = [];
  const database = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
      };
      return statement;
    },
    async batch(next) {
      statements.push(...next);
      return next.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const state = new D1CatalogState(database);

  await state.saveOverride({
    itemId: 'stored',
    title: 'Edited title',
    description: 'Edited description',
    personalState: 'planned',
    updatedAt: '2026-09-12T14:00:00.000Z',
  });

  assert.match(statements[0].sql, /INSERT INTO atlas_item_overrides/u);
  assert.match(statements[1].sql, /UPDATE atlas_catalog_revision/u);
  assert.deepEqual(
    statements.map(({ values }) => values),
    [
      [
        'stored',
        'Edited title',
        'Edited description',
        'planned',
        '2026-09-12T14:00:00.000Z',
      ],
      [],
    ],
  );
});
