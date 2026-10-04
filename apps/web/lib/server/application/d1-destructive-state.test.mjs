import assert from 'node:assert/strict';
import test from 'node:test';

import { D1DestructiveState } from './d1-destructive-state.ts';

const row = {
  item_id: 'place-one',
  payload_json: '{"id":"place-one"}',
  override_title: 'Edited',
  override_description: 'Description',
  override_personal_state: 'saved',
  override_updated_at: 'override-time',
  overall_rating: 4.2,
  is_favorite: 1,
  has_visited: 1,
  assessment_updated_at: 'assessment-time',
  tombstone_id: null,
  visit_count: 2,
  media_object_keys_json: '["visits/visit-one/one","visits/visit-one/two"]',
};

test('the D1 destructive adapter collects Visit object keys and commits its cascade atomically', async () => {
  const database = fakeDatabase({
    firstRows: [{ visit_id: 'visit-one', ...row }],
  });
  const state = new D1DestructiveState(database.value);

  assert.deepEqual(await state.readVisitDeletion('visit-one'), {
    itemId: 'place-one',
    dynamicPayload: '{"id":"place-one"}',
    override: {
      itemId: 'place-one',
      title: 'Edited',
      description: 'Description',
      personalState: 'saved',
      updatedAt: 'override-time',
    },
    assessment: {
      itemId: 'place-one',
      overallRating: 4.2,
      isFavorite: true,
      manualVisited: true,
      updatedAt: 'assessment-time',
    },
    tombstoned: false,
    visitCount: 2,
    mediaObjectKeys: ['visits/visit-one/one', 'visits/visit-one/two'],
  });
  await state.commitVisitDeletion('visit-one');

  assert.equal(database.roundTrips(), 2);
  assert.equal(database.batches.length, 1);
  assert.deepEqual(
    database.batches[0].map((statement) => statement.values),
    [['visit-one'], ['visit-one'], ['visit-one']],
  );
  assert.match(database.batches[0][0].sql, /DELETE FROM visit_media/u);
  assert.match(database.batches[0][1].sql, /DELETE FROM visits/u);
  assert.match(database.batches[0][2].sql, /DELETE FROM journal_entries/u);
  assert.doesNotMatch(
    database.batches[0].map((statement) => statement.sql).join('\n'),
    /place_assessments/u,
  );
});

test('the D1 destructive adapter resolves a Review Candidate as the Visit deletion target', async () => {
  const candidatePayload =
    '{"recordType":"review_candidate","id":"review-one"}';
  const database = fakeDatabase({
    firstRows: [
      {
        ...row,
        item_id: 'review-one',
        payload_json: null,
        review_candidate_payload_json: candidatePayload,
        visit_count: 1,
      },
    ],
  });
  const state = new D1DestructiveState(database.value);

  const context = await state.readVisitDeletion('candidate-visit');

  assert.equal(context.dynamicPayload, candidatePayload);
  assert.match(database.statements[0].sql, /atlas_review_candidates/u);
});

test('the D1 destructive adapter atomically removes all item records and writes a tombstone', async () => {
  const database = fakeDatabase({ firstRows: [row] });
  const state = new D1DestructiveState(database.value);

  const context = await state.readItemDeletion('place-one');
  await state.commitItemDeletion('place-one', '2026-09-12T12:00:00.000Z');

  assert.deepEqual(context.mediaObjectKeys, [
    'visits/visit-one/one',
    'visits/visit-one/two',
  ]);
  assert.equal(database.roundTrips(), 2);
  assert.equal(database.batches.length, 1);
  const sql = database.batches[0].map((statement) => statement.sql).join('\n');
  for (const table of [
    'visit_media',
    'visits',
    'journal_entries',
    'place_assessments',
    'atlas_item_overrides',
    'atlas_review_candidates',
    'atlas_items',
    'atlas_google_rating_references',
  ]) {
    assert.match(sql, new RegExp(`DELETE FROM ${table}`, 'u'), table);
  }
  assert.match(sql, /INSERT INTO atlas_item_tombstones/u);
  assert.deepEqual(
    database.batches[0].find((statement) =>
      statement.sql.includes('INSERT INTO atlas_item_tombstones'),
    ).values,
    ['place-one', '2026-09-12T12:00:00.000Z'],
  );
});

test('a rejected destructive D1 batch performs no standalone structured writes', async () => {
  let standaloneWrites = 0;
  const database = fakeDatabase({
    batchError: new Error('secret D1 transaction failure'),
    onRun: () => {
      standaloneWrites += 1;
    },
  });
  const state = new D1DestructiveState(database.value);

  await assert.rejects(
    state.commitItemDeletion('place-one', 'deleted'),
    /secret D1 transaction failure/u,
  );
  assert.equal(database.batches.length, 1);
  assert.equal(standaloneWrites, 0);
});

function fakeDatabase({ firstRows = [], batchError, onRun = () => {} } = {}) {
  let roundTrips = 0;
  let firstIndex = 0;
  const batches = [];
  const statements = [];
  const value = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async first() {
          roundTrips += 1;
          return firstRows[firstIndex++];
        },
        async run() {
          onRun();
        },
      };
      statements.push(statement);
      return statement;
    },
    async batch(statements) {
      roundTrips += 1;
      batches.push(statements);
      if (batchError) throw batchError;
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return {
    value,
    batches,
    statements,
    roundTrips: () => roundTrips,
  };
}
