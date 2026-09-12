import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../../../product/application/atlas-application.ts';
import { createPlaceAssessmentOperationGroup } from '../../../../../product/application/assessments/place-assessment-operations.ts';
import { InMemoryPlaceAssessmentState } from '../../../../../product/application/assessments/in-memory-place-assessment-state.ts';
import { createCatalogRead } from '../../../../../product/application/catalog/catalog-read.ts';
import { updatePlaceAssessmentResponse } from './update-place-assessment-response.ts';

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

function createApplication() {
  const state = new InMemoryPlaceAssessmentState({
    visitCounts: [{ itemId: item.id, count: 1 }],
  });
  return createAtlasApplication(
    createPlaceAssessmentOperationGroup(
      createCatalogRead(state, [item]),
      state,
      { clock: { now: () => '2026-09-12T10:00:00.000Z' } },
    ),
  );
}

test('the personal HTTP adapter maps legacy hasVisited and returns the existing item shape', async () => {
  const response = await updatePlaceAssessmentResponse(
    createApplication(),
    item.id,
    {
      overallRating: 3.76,
      isFavorite: true,
      hasVisited: false,
      summary: '  Good  ',
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ...item,
    personalRating: 3.8,
    isFavorite: true,
    hasVisited: true,
  });
});

test('the personal HTTP adapter preserves validation, not-found and dependency statuses', async () => {
  const application = createApplication();
  const invalid = await updatePlaceAssessmentResponse(application, item.id, {
    overallRating: 6,
  });
  const missing = await updatePlaceAssessmentResponse(application, 'missing', {
    isFavorite: true,
  });
  const unavailable = await updatePlaceAssessmentResponse(
    {
      async execute() {
        return {
          ok: false,
          error: {
            kind: 'dependency_failure',
            message: 'secret should not be returned',
          },
        };
      },
    },
    item.id,
    { isFavorite: true },
  );

  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), 'Invalid personal item update');
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Atlas item not found');
  assert.equal(unavailable.status, 500);
  assert.equal(
    await unavailable.text(),
    'The personal place status could not be saved.',
  );
});
