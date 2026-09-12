import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createCatalogItemProjection } from '../../../product/application/catalog/catalog-item-projection.ts';
import { InMemoryVisitState } from '../../../product/application/visits/in-memory-visit-state.ts';
import { createVisitOperationGroup } from '../../../product/application/visits/visit-operations.ts';
import {
  createVisitResponse,
  listVisitsResponse,
  updateVisitResponse,
} from './visit-responses.ts';

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
const dependencies = {
  clock: { now: () => '2026-09-12T12:00:00.000Z' },
  idSource: { nextId: () => 'visit-one' },
};

function application(initial = {}) {
  return createAtlasApplication(
    createVisitOperationGroup(
      new InMemoryVisitState(initial),
      createCatalogItemProjection([item]),
      dependencies,
    ),
  );
}

test('Journal GET and POST preserve the existing JSON shapes and 201 status', async () => {
  const app = application();
  const created = await createVisitResponse(app, {
    itemId: item.id,
    visitedAt: '2026-09-12',
    rating: 3.76,
  });
  const listed = await listVisitsResponse(app);

  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {
    visit: {
      id: 'visit-one',
      itemId: item.id,
      itemTitle: item.title,
      visitedAt: '2026-09-12',
      createdAt: dependencies.clock.now(),
      updatedAt: dependencies.clock.now(),
    },
    item: {
      ...item,
      personalRating: 3.8,
      isFavorite: false,
      hasVisited: true,
    },
  });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).length, 1);
});

test('Journal PATCH preserves update and rating-clear response semantics', async () => {
  const app = application({
    visits: [
      {
        id: 'visit-one',
        itemId: item.id,
        itemTitle: item.title,
        visitedAt: '2026-09-10',
        note: 'old',
        createdAt: 'created',
        updatedAt: 'created',
      },
    ],
    assessments: [
      {
        itemId: item.id,
        overallRating: 4.4,
        isFavorite: true,
        manualVisited: false,
        summary: 'keep',
        updatedAt: 'created',
      },
    ],
  });

  const response = await updateVisitResponse(app, 'visit-one', {
    visitedAt: '2026-09-12',
    note: '',
    rating: null,
  });

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.visit.note, undefined);
  assert.equal(result.item.personalRating, undefined);
  assert.equal(result.item.isFavorite, true);
  assert.equal(result.item.hasVisited, true);
});

test('Journal adapters preserve invalid and not-found statuses', async () => {
  const app = application();
  const invalidCreate = await createVisitResponse(app, {
    itemId: item.id,
    visitedAt: '2026-09-12',
  });
  const missingItem = await createVisitResponse(app, {
    itemId: 'missing',
    visitedAt: '2026-09-12',
    rating: 4,
  });
  const invalidUpdate = await updateVisitResponse(app, 'visit-one', {
    visitedAt: '',
  });
  const missingVisit = await updateVisitResponse(app, 'missing', {
    visitedAt: '2026-09-12',
  });

  assert.equal(invalidCreate.status, 400);
  assert.equal(
    await invalidCreate.text(),
    'Valid place and date are required; add at least a rating or note, and keep ratings between 0 and 5',
  );
  assert.equal(missingItem.status, 404);
  assert.equal(await missingItem.text(), 'Atlas item not found');
  assert.equal(invalidUpdate.status, 400);
  assert.equal(await invalidUpdate.text(), 'Invalid visit update');
  assert.equal(missingVisit.status, 404);
  assert.equal(await missingVisit.text(), 'Journal entry not found');
});

test('Journal dependency failures map to sanitized 500 responses', async () => {
  const failing = {
    async execute() {
      return {
        ok: false,
        error: {
          kind: 'dependency_failure',
          message: 'secret D1 binding detail',
        },
      };
    },
  };
  const responses = await Promise.all([
    listVisitsResponse(failing),
    createVisitResponse(failing, {
      itemId: item.id,
      visitedAt: '2026-09-12',
      rating: 4,
    }),
    updateVisitResponse(failing, 'visit-one', {
      visitedAt: '2026-09-12',
    }),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /secret|D1|binding/u);
  }
});
