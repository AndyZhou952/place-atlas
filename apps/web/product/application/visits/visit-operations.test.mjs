import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createCatalogItemProjection } from '../catalog/catalog-item-projection.ts';
import { InMemoryVisitState } from './in-memory-visit-state.ts';
import { createVisitOperationGroup } from './visit-operations.ts';

const places = [
  place('place-one', 'Place one'),
  place('place-two', 'Place two'),
];
const dependencies = {
  clock: { now: () => '2026-09-12T12:00:00.000Z' },
  idSource: { nextId: () => 'generated-visit' },
};

function fixture(initial = {}) {
  const state = new InMemoryVisitState(initial);
  const application = createAtlasApplication(
    createVisitOperationGroup(
      state,
      createCatalogItemProjection(places),
      dependencies,
    ),
  );
  return { application, state };
}

test('Visit list is newest visit first with creation time as the stable tie-breaker', async () => {
  const older = visit('older', 'place-one', '2026-09-10', '2026-09-01');
  const newerCreated = visit(
    'newer-created',
    'place-one',
    '2026-09-10',
    '2026-09-02',
  );
  const latest = visit('latest', 'place-one', '2026-09-11', '2026-09-01');
  const { application } = fixture({ visits: [older, latest, newerCreated] });

  assert.deepEqual(
    await application.execute({ key: 'visit.list', input: {} }),
    { ok: true, value: [latest, newerCreated, older] },
  );
});

test('create accepts a rating by itself and normalizes 0, 5, and arbitrary decimals', async () => {
  for (const [rating, expected] of [
    [0, 0],
    [5, 5],
    [3.76, 3.8],
  ]) {
    const { application } = fixture();
    const result = await application.execute({
      key: 'visit.create',
      input: {
        id: `visit-${rating}`,
        itemId: 'place-one',
        visitedAt: '2026-09-12',
        rating,
      },
    });
    assert.equal(result.ok && result.value.visit.note, undefined);
    assert.equal(result.ok && result.value.item.personalRating, expected);
    assert.equal(result.ok && result.value.item.hasVisited, true);
  }
});

test('create accepts a note by itself but rejects an empty Visit', async () => {
  const { application } = fixture();
  const created = await application.execute({
    key: 'visit.create',
    input: {
      itemId: 'place-one',
      visitedAt: '2026-09-12',
      note: '  omakase  ',
    },
  });
  const invalid = await application.execute({
    key: 'visit.create',
    input: {
      itemId: 'place-one',
      visitedAt: '2026-09-12',
      note: '   ',
    },
  });

  assert.equal(created.ok && created.value.visit.note, 'omakase');
  assert.equal(created.ok && created.value.visit.id, 'generated-visit');
  assert.equal(invalid.ok, false);
  assert.equal(!invalid.ok && invalid.error.kind, 'invalid_input');
});

test('create never writes manualVisited and derives effectiveVisited from the Visit', async () => {
  const { application, state } = fixture({
    assessments: [assessment('place-one', { manualVisited: false })],
  });

  const result = await application.execute({
    key: 'visit.create',
    input: {
      id: 'visit-one',
      itemId: 'place-one',
      visitedAt: '2026-09-12',
      rating: 4.2,
    },
  });

  assert.equal(result.ok && result.value.item.hasVisited, true);
  assert.equal(
    (await state.readItemContext('place-one')).assessment.manualVisited,
    false,
  );
});

test('same-ID retries never add a Visit but still apply the current request assessment and view', async () => {
  const { application } = fixture();
  const original = {
    id: 'stable-id',
    itemId: 'place-one',
    visitedAt: '2026-09-10',
    note: 'first',
    rating: 2,
  };
  await application.execute({ key: 'visit.create', input: original });
  await application.execute({ key: 'visit.create', input: original });
  const different = await application.execute({
    key: 'visit.create',
    input: {
      id: 'stable-id',
      itemId: 'place-two',
      visitedAt: '2026-09-12',
      note: 'current request',
      rating: 4.26,
    },
  });
  const listed = await application.execute({ key: 'visit.list', input: {} });

  assert.equal(listed.ok && listed.value.length, 1);
  assert.equal(listed.ok && listed.value[0].itemId, 'place-one');
  assert.equal(different.ok && different.value.visit.itemId, 'place-two');
  assert.equal(different.ok && different.value.visit.note, 'current request');
  assert.equal(different.ok && different.value.item.personalRating, 4.3);
  assert.equal(different.ok && different.value.item.hasVisited, false);
  assert.ok(different.ok);
  assert.equal('receipt' in different.value, false);
});

test('update can clear note and rating while preserving unrelated assessment state', async () => {
  const existing = visit(
    'visit-one',
    'place-one',
    '2026-09-10',
    '2026-09-10T01:00:00.000Z',
    'old note',
  );
  const { application, state } = fixture({
    visits: [existing],
    assessments: [
      assessment('place-one', {
        overallRating: 4.4,
        isFavorite: true,
        manualVisited: false,
        summary: 'keep me',
      }),
    ],
  });

  const cleared = await application.execute({
    key: 'visit.update',
    input: {
      id: 'visit-one',
      visitedAt: '2026-09-12',
      note: '   ',
      rating: null,
    },
  });

  assert.equal(cleared.ok && cleared.value.visit.note, undefined);
  assert.equal(cleared.ok && cleared.value.item.personalRating, undefined);
  assert.equal(cleared.ok && cleared.value.item.hasVisited, true);
  assert.deepEqual((await state.readItemContext('place-one')).assessment, {
    itemId: 'place-one',
    isFavorite: true,
    manualVisited: false,
    summary: 'keep me',
    updatedAt: dependencies.clock.now(),
  });
});

test('update preserves rating when omitted and accepts normalized values at both boundaries', async () => {
  for (const [rating, expected] of [
    [undefined, 3.3],
    [0, 0],
    [5, 5],
    [3.76, 3.8],
  ]) {
    const { application } = fixture({
      visits: [visit('visit-one', 'place-one', '2026-09-10', 'created')],
      assessments: [assessment('place-one', { overallRating: 3.3 })],
    });
    const result = await application.execute({
      key: 'visit.update',
      input: {
        id: 'visit-one',
        visitedAt: '2026-09-12',
        ...(rating === undefined ? {} : { rating }),
      },
    });
    assert.equal(result.ok && result.value.item.personalRating, expected);
  }
});

test('missing records and state failures use closed sanitized errors', async () => {
  const { application } = fixture();
  assert.deepEqual(
    await application.execute({
      key: 'visit.create',
      input: {
        itemId: 'missing',
        visitedAt: '2026-09-12',
        rating: 4,
      },
    }),
    {
      ok: false,
      error: { kind: 'not_found', message: 'Atlas item not found.' },
    },
  );
  assert.deepEqual(
    await application.execute({
      key: 'visit.update',
      input: { id: 'missing', visitedAt: '2026-09-12' },
    }),
    {
      ok: false,
      error: { kind: 'not_found', message: 'Journal entry not found.' },
    },
  );

  const failingState = {
    async list() {
      throw new Error('secret binding detail');
    },
    async readItemContext() {
      throw new Error('secret binding detail');
    },
    async readVisitContext() {
      throw new Error('secret binding detail');
    },
    async create() {
      throw new Error('secret binding detail');
    },
    async update() {
      throw new Error('secret binding detail');
    },
  };
  const failingApplication = createAtlasApplication(
    createVisitOperationGroup(
      failingState,
      createCatalogItemProjection(places),
      dependencies,
    ),
  );
  for (const operation of [
    { key: 'visit.list', input: {} },
    {
      key: 'visit.create',
      input: { itemId: 'place-one', visitedAt: 'date', rating: 4 },
    },
    {
      key: 'visit.update',
      input: { id: 'visit-one', visitedAt: 'date' },
    },
  ]) {
    const result = await failingApplication.execute(operation);
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'dependency_failure');
    assert.doesNotMatch(JSON.stringify(result), /secret|binding/u);
  }
});

function place(id, title) {
  return {
    id,
    kind: 'food',
    title,
    area: 'Tokyo',
    address: 'Tokyo address',
    description: 'Description',
    latitude: 35.68,
    longitude: 139.76,
    verificationStatus: 'verified',
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
}

function visit(id, itemId, visitedAt, createdAt, note) {
  return {
    id,
    itemId,
    itemTitle: places.find((item) => item.id === itemId)?.title ?? 'Place',
    visitedAt,
    ...(note ? { note } : {}),
    createdAt,
    updatedAt: createdAt,
  };
}

function assessment(itemId, overrides = {}) {
  return {
    itemId,
    isFavorite: false,
    manualVisited: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}
