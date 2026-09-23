import assert from 'node:assert/strict';
import test from 'node:test';

import { D1PlaceAssessmentState } from './d1-place-assessment-state.ts';

test('the D1 adapter hides legacy has_visited behind manualVisited', async () => {
  const database = {
    prepare(sql) {
      return {
        bind(itemId) {
          assert.equal(itemId, 'place-one');
          return {
            async first() {
              if (/FROM place_assessments/u.test(sql)) {
                return {
                  item_id: 'place-one',
                  overall_rating: 3.7,
                  is_favorite: 1,
                  has_visited: 0,
                  summary: 'Summary',
                  updated_at: '2026-09-12T01:00:00.000Z',
                };
              }
              if (/COUNT\(\*\).*FROM visits/su.test(sql)) {
                return { visit_count: 2 };
              }
              assert.fail(`Unexpected assessment query: ${sql}`);
            },
          };
        },
      };
    },
  };

  const result = await new D1PlaceAssessmentState(database).read('place-one');

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
