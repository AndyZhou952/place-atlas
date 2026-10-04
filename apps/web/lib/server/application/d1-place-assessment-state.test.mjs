import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { D1PlaceAssessmentState } from './d1-place-assessment-state.ts';

test('the D1 adapter hides legacy has_visited behind manualVisited', async () => {
  let reads = 0;
  const database = {
    prepare(sql) {
      assert.match(sql, /LEFT JOIN place_assessments/u);
      assert.match(sql, /COUNT\(\*\).*FROM visits/su);
      return {
        bind(...itemIds) {
          assert.deepEqual(itemIds, ['place-one', 'place-one']);
          return {
            async first() {
              reads++;
              return {
                item_id: 'place-one',
                overall_rating: 3.7,
                is_favorite: 1,
                has_visited: 0,
                summary: 'Summary',
                updated_at: '2026-09-12T01:00:00.000Z',
                visit_count: 2,
              };
            },
          };
        },
      };
    },
  };

  const result = await new D1PlaceAssessmentState(database).read('place-one');
  assert.equal(reads, 1);

  assert.deepEqual(result, {
    assessment: {
      itemId: 'place-one',
      overallRating: 3.7,
      isFavorite: true,
      manualVisited: false,
      summary: 'Summary',
      updatedAt: '2026-09-12T01:00:00.000Z',
    },
    visitCount: 2,
  });
});

test('a single SQLite read preserves visits with and without a manual assessment', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE place_assessments (
    item_id TEXT PRIMARY KEY, overall_rating REAL, is_favorite INTEGER,
    has_visited INTEGER, summary TEXT, updated_at TEXT
  );
  CREATE TABLE visits (item_id TEXT NOT NULL);`);
  sqlite.prepare('INSERT INTO visits (item_id) VALUES (?)').run('place-one');
  sqlite.prepare('INSERT INTO visits (item_id) VALUES (?)').run('place-one');
  const database = {
    prepare(sql) {
      return {
        bind(...values) {
          return { first: async () => sqlite.prepare(sql).get(...values) };
        },
      };
    },
  };
  const state = new D1PlaceAssessmentState(database);
  assert.deepEqual(await state.read('place-one'), {
    assessment: undefined,
    visitCount: 2,
  });
  sqlite
    .prepare(`INSERT INTO place_assessments VALUES (?, ?, ?, ?, ?, ?)`)
    .run('place-one', 4.2, 1, 0, 'Review', '2026-09-29');
  assert.deepEqual(await state.read('place-one'), {
    assessment: {
      itemId: 'place-one',
      overallRating: 4.2,
      isFavorite: true,
      manualVisited: false,
      summary: 'Review',
      updatedAt: '2026-09-29',
    },
    visitCount: 2,
  });
  assert.deepEqual(await state.read('missing'), {
    assessment: undefined,
    visitCount: 0,
  });
});

test('the D1 adapter persists the full assessment while retaining the old column name', async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      assert.match(sql, /INSERT INTO place_assessments/u);
      assert.match(sql, /has_visited/u);
      return {
        bind(...values) {
          calls.push(values);
          return { values };
        },
      };
    },
    async batch(statements) {
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const state = new D1PlaceAssessmentState(database);

  await state.save({
    itemId: 'place-one',
    overallRating: 0,
    isFavorite: false,
    manualVisited: true,
    updatedAt: '2026-09-12T02:00:00.000Z',
  });

  assert.deepEqual(calls, [
    [
      'place-one',
      0,
      0,
      1,
      null,
      '2026-09-12T02:00:00.000Z',
      '2026-09-12T02:00:00.000Z',
    ],
  ]);
});
