import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createCatalogRead } from '../catalog/catalog-read.ts';
import { createPlaceAssessmentOperationGroup } from './place-assessment-operations.ts';
import { InMemoryPlaceAssessmentState } from './in-memory-place-assessment-state.ts';

const item = {
  id: 'place-one',
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

const clock = { now: () => '2026-09-12T10:00:00.000Z' };

function createFixture({ assessment, visitCount = 0 } = {}) {
  const state = new InMemoryPlaceAssessmentState({
    assessments: assessment ? [assessment] : [],
    visitCounts: visitCount ? [{ itemId: item.id, count: visitCount }] : [],
  });
  const application = createAtlasApplication(
    createPlaceAssessmentOperationGroup(
      createCatalogRead(state, [item]),
      state,
      { clock },
    ),
  );
  return { application, state };
}

async function update(application, patch) {
  return application.execute({
    key: 'assessment.update',
    input: { itemId: item.id, patch },
  });
}

test('ratings accept 0, 5 and arbitrary decimals normalized to one decimal place', async () => {
  for (const [input, expected] of [
    [0, 0],
    [5, 5],
    [3.76, 3.8],
  ]) {
    const { application } = createFixture();
    const result = await update(application, { overallRating: input });
    assert.equal(result.ok && result.value.assessment.overallRating, expected);
    assert.equal(result.ok && result.value.item.personalRating, expected);
  }
});

test('rating, favorite, manual visited and summary update independently', async () => {
  const initial = {
    itemId: item.id,
    overallRating: 2.1,
    isFavorite: true,
    manualVisited: false,
    summary: 'keep me',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const { application } = createFixture({ assessment: initial });

  const rating = await update(application, { overallRating: 3.76 });
  assert.deepEqual(rating.ok && rating.value.assessment, {
    ...initial,
    overallRating: 3.8,
    updatedAt: clock.now(),
  });

  const favorite = await update(application, { isFavorite: false });
  assert.deepEqual(favorite.ok && favorite.value.assessment, {
    ...initial,
    overallRating: 3.8,
    isFavorite: false,
    updatedAt: clock.now(),
  });

  const manualVisited = await update(application, { manualVisited: true });
  assert.deepEqual(manualVisited.ok && manualVisited.value.assessment, {
    ...initial,
    overallRating: 3.8,
    isFavorite: false,
    manualVisited: true,
    updatedAt: clock.now(),
  });

  const summary = await update(application, { summary: '  changed  ' });
  assert.deepEqual(summary.ok && summary.value.assessment, {
    ...initial,
    overallRating: 3.8,
    isFavorite: false,
    manualVisited: true,
    summary: 'changed',
    updatedAt: clock.now(),
  });
});

test('effective visited is manualVisited OR Visit count for every truth-table row', async () => {
  for (const [manualVisited, visitCount, expected] of [
    [false, 0, false],
    [false, 1, true],
    [true, 0, true],
    [true, 2, true],
  ]) {
    const { application, state } = createFixture({ visitCount });
    const result = await update(application, { manualVisited });
    assert.equal(result.ok && result.value.item.hasVisited, expected);
    assert.equal(
      result.ok && result.value.assessment.manualVisited,
      manualVisited,
    );
    assert.equal(
      (await createCatalogRead(state, [item]).get(item.id))?.hasVisited,
      expected,
    );
  }
});

test('clearing a rating or summary preserves every other assessment state', async () => {
  const assessment = {
    itemId: item.id,
    overallRating: 4.4,
    isFavorite: true,
    manualVisited: true,
    summary: 'old summary',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const { application } = createFixture({ assessment });

  const clearedRating = await update(application, { overallRating: null });
  assert.deepEqual(clearedRating.ok && clearedRating.value.assessment, {
    itemId: item.id,
    isFavorite: true,
    manualVisited: true,
    summary: 'old summary',
    updatedAt: clock.now(),
  });

  const clearedSummary = await update(application, { summary: null });
  assert.deepEqual(clearedSummary.ok && clearedSummary.value.assessment, {
    itemId: item.id,
    isFavorite: true,
    manualVisited: true,
    updatedAt: clock.now(),
  });
});

test('invalid inputs and missing items return public failures', async () => {
  const { application } = createFixture();
  for (const overallRating of [-0.1, 5.1, Number.NaN]) {
    assert.equal((await update(application, { overallRating })).ok, false);
  }
  assert.deepEqual(
    await application.execute({
      key: 'assessment.update',
      input: { itemId: 'missing', patch: { isFavorite: true } },
    }),
    {
      ok: false,
      error: { kind: 'not_found', message: 'Atlas item not found.' },
    },
  );
});

test('assessment read dependency details are sanitized', async () => {
  const readFailureState = {
    async readSnapshot() {
      return {
        dynamicPayloads: [],
        overrides: [],
        assessments: [],
        tombstoneIds: [],
        visitCounts: [],
      };
    },
    async read() {
      throw new Error('secret database detail');
    },
    async save() {
      throw new Error('secret database detail');
    },
  };
  const failingApplication = createAtlasApplication(
    createPlaceAssessmentOperationGroup(
      createCatalogRead(readFailureState, [item]),
      readFailureState,
      { clock },
    ),
  );
  assert.deepEqual(await update(failingApplication, { isFavorite: true }), {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'The personal place status could not be saved.',
    },
  });
});

test('assessment save dependency details are sanitized separately', async () => {
  const saveFailureState = {
    async readSnapshot() {
      return {
        dynamicPayloads: [],
        overrides: [],
        assessments: [],
        tombstoneIds: [],
        visitCounts: [],
      };
    },
    async read() {
      return { assessment: undefined, visitCount: 0 };
    },
    async save() {
      throw new Error('secret save detail');
    },
  };
  const saveFailureApplication = createAtlasApplication(
    createPlaceAssessmentOperationGroup(
      createCatalogRead(saveFailureState, [item]),
      saveFailureState,
      { clock },
    ),
  );

  assert.deepEqual(await update(saveFailureApplication, { isFavorite: true }), {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'The personal place status could not be saved.',
    },
  });
});
