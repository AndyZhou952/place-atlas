import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createCatalogItemProjection } from '../catalog/catalog-item-projection.ts';
import { createDestructiveOperationGroup } from './destructive-operations.ts';
import { InMemoryDestructiveState } from './in-memory-destructive-state.ts';

const item = atlasItem('place-one');
const clock = { now: () => '2026-09-12T12:00:00.000Z' };

test('deleting a Visit commits structured records before best-effort object cleanup', async () => {
  const events = [];
  const state = {
    async readVisitDeletion(id) {
      assert.equal(id, 'visit-one');
      return context({ visitCount: 2, mediaObjectKeys: ['one', 'two'] });
    },
    async commitVisitDeletion(id) {
      events.push(['d1', id]);
    },
    async readItemDeletion() {
      throw new Error('not used');
    },
    async commitItemDeletion() {
      throw new Error('not used');
    },
  };
  const objects = {
    async delete(key) {
      events.push(['r2', key]);
    },
  };
  const application = createAtlasApplication(
    createDestructiveOperationGroup(
      state,
      createCatalogItemProjection([item]),
      objects,
      { clock },
    ),
  );

  const result = await application.execute({
    key: 'visit.delete',
    input: { id: 'visit-one' },
  });

  assert.deepEqual(events, [
    ['d1', 'visit-one'],
    ['r2', 'one'],
    ['r2', 'two'],
  ]);
  assert.equal(result.ok && result.value.item.hasVisited, true);
});

test('Visit deletion derives final effective visited from remaining Visits or manualVisited', async () => {
  for (const [manualVisited, visitCount, expected] of [
    [false, 1, false],
    [true, 1, true],
    [false, 2, true],
    [true, 2, true],
  ]) {
    const application = applicationWith({
      async readVisitDeletion() {
        return context({
          assessment: {
            itemId: item.id,
            isFavorite: false,
            manualVisited,
            updatedAt: 'updated',
          },
          visitCount,
        });
      },
    });
    const result = await application.execute({
      key: 'visit.delete',
      input: { id: 'visit-one' },
    });
    assert.equal(
      result.ok && result.value.item.hasVisited,
      expected,
      `${manualVisited} OR ${visitCount - 1}`,
    );
  }
});

test('Visit deletion keeps success when object cleanup fails, but not when D1 fails', async () => {
  const attempted = [];
  const cleanupFailure = applicationWith(
    {
      async readVisitDeletion() {
        return context({ mediaObjectKeys: ['one', 'two'] });
      },
    },
    {
      async delete(key) {
        attempted.push(key);
        if (key === 'one') throw new Error('secret R2 failure');
      },
    },
  );
  const cleanupResult = await cleanupFailure.execute({
    key: 'visit.delete',
    input: { id: 'visit-one' },
  });
  assert.equal(cleanupResult.ok, true);
  assert.deepEqual(attempted, ['one', 'two']);

  let objectDeleteCalled = false;
  const d1Failure = applicationWith(
    {
      async readVisitDeletion() {
        return context({ mediaObjectKeys: ['one'] });
      },
      async commitVisitDeletion() {
        throw new Error('secret D1 failure');
      },
    },
    {
      async delete() {
        objectDeleteCalled = true;
      },
    },
  );
  const failed = await d1Failure.execute({
    key: 'visit.delete',
    input: { id: 'visit-one' },
  });
  assert.deepEqual(failed, {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'The Journal entry could not be deleted.',
    },
  });
  assert.equal(objectDeleteCalled, false);
  assert.doesNotMatch(JSON.stringify(failed), /secret|D1/u);
});

test('AtlasItem deletion tombstones the item after one atomic commit and tolerates orphaned objects', async () => {
  const events = [];
  let tombstoned = false;
  const state = stateWith({
    async readItemDeletion(id) {
      assert.equal(id, item.id);
      return context({
        tombstoned,
        mediaObjectKeys: ['one', 'two'],
      });
    },
    async commitItemDeletion(id, deletedAt) {
      events.push(['d1', id, deletedAt]);
      tombstoned = true;
    },
  });
  const objects = {
    async delete(key) {
      events.push(['r2', key]);
      if (key === 'one') throw new Error('secret R2 failure');
    },
  };
  const application = app(state, objects);

  const deleted = await application.execute({
    key: 'catalog.delete_item',
    input: { id: item.id },
  });
  const deletedAgain = await application.execute({
    key: 'catalog.delete_item',
    input: { id: item.id },
  });

  assert.deepEqual(deleted, {
    ok: true,
    value: { id: item.id, deleted: true },
  });
  assert.deepEqual(events, [
    ['d1', item.id, clock.now()],
    ['r2', 'one'],
    ['r2', 'two'],
  ]);
  assert.deepEqual(deletedAgain, {
    ok: false,
    error: { kind: 'not_found', message: 'Atlas item not found.' },
  });
});

test('destructive operations close missing records and sanitize state failures', async () => {
  const missingVisit = applicationWith({
    async readVisitDeletion() {
      return undefined;
    },
  });
  assert.deepEqual(
    await missingVisit.execute({
      key: 'visit.delete',
      input: { id: 'missing' },
    }),
    {
      ok: false,
      error: { kind: 'not_found', message: 'Journal entry not found.' },
    },
  );

  const failing = app(
    stateWith({
      async readItemDeletion() {
        throw new Error('secret binding detail');
      },
    }),
  );
  const result = await failing.execute({
    key: 'catalog.delete_item',
    input: { id: item.id },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'dependency_failure');
  assert.doesNotMatch(JSON.stringify(result), /secret|binding/u);
});

test('the InMemory adapter removes the complete AtlasItem aggregate and exposes its tombstone', async () => {
  const dynamic = atlasItem('dynamic-item');
  const state = new InMemoryDestructiveState({
    dynamicPayloads: [JSON.stringify(dynamic)],
    overrides: [
      {
        itemId: dynamic.id,
        title: 'Edited',
        description: 'Edited description',
        personalState: 'saved',
        updatedAt: 'updated',
      },
    ],
    assessments: [
      {
        itemId: dynamic.id,
        overallRating: 4.5,
        isFavorite: true,
        manualVisited: true,
      },
    ],
    visits: [{ id: 'visit-dynamic', itemId: dynamic.id }],
    media: [
      {
        visitId: 'visit-dynamic',
        itemId: dynamic.id,
        objectKey: 'visits/visit-dynamic/media-one',
      },
    ],
  });
  const application = createAtlasApplication(
    createDestructiveOperationGroup(
      state,
      createCatalogItemProjection([]),
      { async delete() {} },
      { clock },
    ),
  );

  const deleted = await application.execute({
    key: 'catalog.delete_item',
    input: { id: dynamic.id },
  });
  const snapshot = state.snapshot();

  assert.equal(deleted.ok, true);
  assert.deepEqual(snapshot.dynamicPayloads, []);
  assert.deepEqual(snapshot.overrides, []);
  assert.deepEqual(snapshot.assessments, []);
  assert.deepEqual(snapshot.visits, []);
  assert.deepEqual(snapshot.media, []);
  assert.deepEqual(snapshot.tombstoneIds, [dynamic.id]);
});

test('destructive descriptors reject blank IDs and remain classified as destructive', async () => {
  const definitions = createDestructiveOperationGroup(
    stateWith(),
    createCatalogItemProjection([item]),
    { async delete() {} },
    { clock },
  );
  const application = createAtlasApplication(definitions);

  assert.equal(definitions['visit.delete'].descriptor.effect, 'destructive');
  assert.equal(
    definitions['catalog.delete_item'].descriptor.effect,
    'destructive',
  );
  for (const key of ['visit.delete', 'catalog.delete_item']) {
    const result = await application.execute({ key, input: { id: '   ' } });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'invalid_input');
  }
});

function applicationWith(stateOverrides = {}, objectOverrides = {}) {
  return app(stateWith(stateOverrides), {
    async delete() {},
    ...objectOverrides,
  });
}

function app(state, objects = { async delete() {} }) {
  return createAtlasApplication(
    createDestructiveOperationGroup(
      state,
      createCatalogItemProjection([item]),
      objects,
      { clock },
    ),
  );
}

function stateWith(overrides = {}) {
  return {
    async readVisitDeletion() {
      return context();
    },
    async commitVisitDeletion() {},
    async readItemDeletion() {
      return context();
    },
    async commitItemDeletion() {},
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    itemId: item.id,
    assessment: {
      itemId: item.id,
      isFavorite: false,
      manualVisited: false,
      updatedAt: 'updated',
    },
    tombstoned: false,
    visitCount: 1,
    mediaObjectKeys: [],
    ...overrides,
  };
}

function atlasItem(id) {
  return {
    id,
    kind: 'food',
    title: 'Place one',
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
