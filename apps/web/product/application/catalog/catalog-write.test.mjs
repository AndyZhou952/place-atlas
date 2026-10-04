import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createCatalogOperationGroup } from './catalog-operations.ts';
import { createCatalogRead } from './catalog-read.ts';
import { InMemoryCatalogState } from './in-memory-catalog-state.ts';
import { withRestaurantClassification } from './restaurant-classification.ts';

const clock = { now: () => '2026-09-12T12:00:00.000Z' };

function item(overrides = {}) {
  return {
    id: 'candidate',
    kind: 'food',
    title: 'Candidate',
    area: 'Tokyo',
    address: 'Tokyo address',
    description: 'Candidate description',
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
    ...overrides,
  };
}

test('collector writes reject verified publication and save only needs-review candidates', async () => {
  const state = new InMemoryCatalogState();
  const application = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(state, []), {
      state,
      clock,
    }),
  );

  assert.deepEqual(
    await application.execute({
      key: 'catalog.save_discovered',
      input: item({ verificationStatus: 'verified' }),
    }),
    {
      ok: false,
      error: {
        kind: 'invalid_input',
        message: 'Collector-created items must enter as needs_review.',
      },
    },
  );

  const candidate = item();
  assert.deepEqual(
    await application.execute({
      key: 'catalog.save_discovered',
      input: candidate,
    }),
    {
      ok: true,
      value: withRestaurantClassification({
        ...candidate,
        updatedAt: '2026-09-12T12:00:00.000Z',
      }),
    },
  );
  assert.deepEqual(
    await application.execute({
      key: 'catalog.get',
      input: { id: candidate.id },
    }),
    {
      ok: true,
      value: {
        ...withRestaurantClassification(candidate),
        updatedAt: '2026-09-12T12:00:00.000Z',
        personalRating: undefined,
        isFavorite: false,
        hasVisited: false,
      },
    },
  );
});

test('collector writes reject empty and whitespace identity fields at the Application seam', async () => {
  const state = new InMemoryCatalogState();
  const application = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(state, []), {
      state,
      clock,
    }),
  );

  for (const field of ['id', 'title', 'description']) {
    for (const value of ['', '   ']) {
      const result = await application.execute({
        key: 'catalog.save_discovered',
        input: item({ [field]: value }),
      });
      assert.equal(result.ok, false, `${field}=${JSON.stringify(value)}`);
      assert.equal(result.error.kind, 'invalid_input');
    }
  }
});

test('item edits merge an override and remain visible after a fresh catalog read', async () => {
  const original = item({
    id: 'existing',
    verificationStatus: 'verified',
    title: 'Original title',
    description: 'Original description',
  });
  const state = new InMemoryCatalogState();
  const application = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(state, [original]), {
      state,
      clock,
    }),
  );

  const updated = await application.execute({
    key: 'catalog.update_item',
    input: {
      id: original.id,
      title: '  Edited title  ',
      description: '  Edited description  ',
      personalState: 'planned',
    },
  });

  const expected = {
    ...original,
    title: 'Edited title',
    description: 'Edited description',
    personalState: 'planned',
    updatedAt: '2026-09-12T12:00:00.000Z',
    personalRating: undefined,
    isFavorite: false,
    hasVisited: false,
  };
  assert.deepEqual(updated, { ok: true, value: expected });
  assert.deepEqual(
    await application.execute({
      key: 'catalog.get',
      input: { id: original.id },
    }),
    { ok: true, value: expected },
  );
});

test('item edits return not_found and write failures stay sanitized', async () => {
  const missingState = new InMemoryCatalogState();
  const missingApplication = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(missingState, []), {
      state: missingState,
      clock,
    }),
  );
  assert.deepEqual(
    await missingApplication.execute({
      key: 'catalog.update_item',
      input: {
        id: 'missing',
        title: 'Edited',
        description: 'Edited',
        personalState: 'saved',
      },
    }),
    {
      ok: false,
      error: { kind: 'not_found', message: 'Atlas item not found.' },
    },
  );

  const failingState = {
    async readSnapshot() {
      return {
        dynamicPayloads: [],
        overrides: [],
        assessments: [],
        tombstoneIds: [],
        visitCounts: [],
      };
    },
    async saveDynamicItem() {
      throw new Error('private D1 insert detail');
    },
    async saveOverride() {
      throw new Error('private D1 override detail');
    },
  };
  const failingApplication = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(failingState, [item()]), {
      state: failingState,
      clock,
    }),
  );
  assert.deepEqual(
    await failingApplication.execute({
      key: 'catalog.save_discovered',
      input: item(),
    }),
    {
      ok: false,
      error: {
        kind: 'dependency_failure',
        message: 'The Atlas item could not be saved.',
      },
    },
  );
  assert.deepEqual(
    await failingApplication.execute({
      key: 'catalog.update_item',
      input: {
        id: 'candidate',
        title: 'Edited',
        description: 'Edited',
        personalState: 'saved',
      },
    }),
    {
      ok: false,
      error: {
        kind: 'dependency_failure',
        message: 'The Atlas item could not be updated.',
      },
    },
  );
});
