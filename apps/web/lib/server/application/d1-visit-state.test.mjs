import assert from 'node:assert/strict';
import test from 'node:test';

import { D1VisitState } from './d1-visit-state.ts';

const assessment = {
  itemId: 'place-one',
  overallRating: 4.2,
  isFavorite: true,
  manualVisited: false,
  summary: 'keep me',
  updatedAt: '2026-09-12T12:00:00.000Z',
};
const createdVisit = {
  id: 'visit-one',
  itemId: 'place-one',
  itemTitle: 'Place one',
  visitedAt: '2026-09-12',
  note: 'note',
  createdAt: '2026-09-12T12:00:00.000Z',
  updatedAt: '2026-09-12T12:00:00.000Z',
};

test('the D1 Visit adapter maps list and item/assessment context without leaking legacy names', async () => {
  const database = queryDatabase({
    listRows: [visitRow(createdVisit)],
    firstRow: {
      item_id: 'place-one',
      payload_json: null,
      override_title: 'Edited title',
      override_description: 'Edited description',
      override_personal_state: 'saved',
      override_updated_at: 'updated',
      overall_rating: 4.2,
      is_favorite: 1,
      has_visited: 0,
      summary: 'keep me',
      assessment_updated_at: 'assessment-updated',
      tombstone_id: null,
      visit_count: 2,
    },
  });
  const state = new D1VisitState(database.value);

  assert.deepEqual(await state.list(), [createdVisit]);
  assert.deepEqual(await state.readItemContext('place-one'), {
    itemId: 'place-one',
    dynamicPayload: undefined,
    override: {
      itemId: 'place-one',
      title: 'Edited title',
      description: 'Edited description',
      personalState: 'saved',
      updatedAt: 'updated',
    },
    assessment: {
      itemId: 'place-one',
      overallRating: 4.2,
      isFavorite: true,
      manualVisited: false,
      summary: 'keep me',
      updatedAt: 'assessment-updated',
    },
    tombstoned: false,
    visitCount: 2,
  });
  assert.equal(database.roundTrips(), 2);
});

test('the D1 Visit adapter resolves an owner-only Review Candidate as a Visit target', async () => {
  const candidatePayload = JSON.stringify({
    recordType: 'review_candidate',
    id: 'review-one',
  });
  const database = queryDatabase({
    firstRow: {
      item_id: 'review-one',
      payload_json: null,
      review_candidate_payload_json: candidatePayload,
      tombstone_id: null,
      visit_count: 0,
    },
  });

  assert.deepEqual(
    await new D1VisitState(database.value).readItemContext('review-one'),
    {
      itemId: 'review-one',
      dynamicPayload: candidatePayload,
      override: undefined,
      assessment: undefined,
      tombstoned: false,
      visitCount: 0,
    },
  );
});

test('create uses one read plus one atomic D1 batch and reports ID insertion', async () => {
  const database = mutationDatabase({ insertChanges: 1 });
  const state = new D1VisitState(database.value);

  await state.readItemContext('place-one');
  const result = await state.create({ visit: createdVisit, assessment });

  assert.deepEqual(result, { inserted: true });
  assert.equal(database.roundTrips(), 2);
  assert.equal(database.batches.length, 1);
  assert.equal(database.batches[0].length, 2);
  assert.match(database.statements[1].sql, /INSERT INTO visits/u);
  assert.deepEqual(database.statements[1].values, [
    'visit-one',
    'place-one',
    'Place one',
    '2026-09-12',
    'note',
    createdVisit.createdAt,
    createdVisit.updatedAt,
  ]);
  assert.match(database.statements[2].sql, /INSERT INTO place_assessments/u);
  assert.deepEqual(database.statements[2].values, [
    'place-one',
    4.2,
    1,
    0,
    'keep me',
    assessment.updatedAt,
    assessment.updatedAt,
  ]);
});

test('a replay still updates the requested assessment when Visit insertion changes zero rows', async () => {
  const database = mutationDatabase({ insertChanges: 0 });
  const state = new D1VisitState(database.value);

  assert.deepEqual(await state.create({ visit: createdVisit, assessment }), {
    inserted: false,
  });
  assert.equal(database.batches[0].length, 2);
});

test('update uses one context read plus one atomic batch and clearing rating writes null', async () => {
  const database = mutationDatabase({ visitRow: visitRow(createdVisit) });
  const state = new D1VisitState(database.value);
  const cleared = { ...assessment, overallRating: undefined };

  await state.readVisitContext('visit-one');
  await state.update({
    visit: { ...createdVisit, note: undefined, visitedAt: '2026-09-13' },
    assessment: cleared,
  });

  assert.equal(database.roundTrips(), 2);
  assert.equal(database.batches[0].length, 3);
  assert.match(database.statements[1].sql, /UPDATE visits/u);
  assert.deepEqual(database.statements[1].values, [
    'place-one',
    'Place one',
    '2026-09-13',
    null,
    createdVisit.updatedAt,
    'visit-one',
  ]);
  assert.match(database.statements[2].sql, /UPDATE visit_media SET item_id/u);
  assert.deepEqual(database.statements[2].values, ['place-one', 'visit-one']);
  assert.equal(database.statements[3].values[1], null);
});

test('a rejected D1 batch exposes no separately committed structured write', async () => {
  let standaloneRuns = 0;
  const database = mutationDatabase({
    batchError: new Error('secret D1 failure'),
    onStandaloneRun: () => {
      standaloneRuns += 1;
    },
  });
  const state = new D1VisitState(database.value);

  await assert.rejects(
    state.create({ visit: createdVisit, assessment }),
    /secret D1 failure/u,
  );
  assert.equal(database.batches.length, 1);
  assert.equal(standaloneRuns, 0);
});

function queryDatabase({ listRows = [], firstRow }) {
  let roundTrips = 0;
  return {
    value: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async all() {
            roundTrips += 1;
            return { results: listRows };
          },
          async first() {
            roundTrips += 1;
            return firstRow;
          },
        };
      },
    },
    roundTrips: () => roundTrips,
  };
}

function mutationDatabase({
  insertChanges = 1,
  visitRow: contextRow,
  batchError,
  onStandaloneRun = () => {},
} = {}) {
  let roundTrips = 0;
  const statements = [];
  const batches = [];
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
          return (
            contextRow ?? {
              item_id: 'place-one',
              visit_count: 0,
              tombstone_id: null,
            }
          );
        },
        async run() {
          onStandaloneRun();
        },
      };
      statements.push(statement);
      return statement;
    },
    async batch(batch) {
      roundTrips += 1;
      batches.push(batch);
      if (batchError) throw batchError;
      return batch.map((_, index) => ({
        meta: { changes: index === 0 ? insertChanges : 1 },
      }));
    },
  };
  return { value, statements, batches, roundTrips: () => roundTrips };
}

function visitRow(visit) {
  return {
    id: visit.id,
    item_id: visit.itemId,
    item_title: visit.itemTitle,
    visited_at: visit.visitedAt,
    note: visit.note ?? null,
    created_at: visit.createdAt,
    updated_at: visit.updatedAt,
  };
}
