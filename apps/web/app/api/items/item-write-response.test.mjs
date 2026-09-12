import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createCatalogOperationGroup } from '../../../product/application/catalog/catalog-operations.ts';
import { createCatalogRead } from '../../../product/application/catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../../../product/application/catalog/in-memory-catalog-state.ts';
import {
  saveDiscoveredItemResponse,
  updateAtlasItemResponse,
} from './item-write-response.ts';

const clock = { now: () => '2026-09-12T15:00:00.000Z' };

const candidate = {
  id: 'candidate',
  kind: 'architecture',
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
};

test('the Items POST adapter preserves 201 and rejects verified collector publication', async () => {
  const state = new InMemoryCatalogState();
  const application = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(state, []), {
      state,
      clock,
    }),
  );

  const created = await saveDiscoveredItemResponse(application, candidate);
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {
    ...candidate,
    updatedAt: '2026-09-12T15:00:00.000Z',
  });

  const rejected = await saveDiscoveredItemResponse(application, {
    ...candidate,
    id: 'verified',
    verificationStatus: 'verified',
  });
  assert.equal(rejected.status, 400);
  assert.equal(
    await rejected.text(),
    'Collector-created items must enter as needs_review',
  );
});

test('the Items POST adapter maps empty and whitespace identity fields to 400', async () => {
  const state = new InMemoryCatalogState();
  const application = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(state, []), {
      state,
      clock,
    }),
  );

  for (const field of ['id', 'title', 'description']) {
    for (const value of ['', '   ']) {
      const response = await saveDiscoveredItemResponse(application, {
        ...candidate,
        [field]: value,
      });
      assert.equal(response.status, 400, `${field}=${JSON.stringify(value)}`);
      assert.equal(
        await response.text(),
        'id, title, kind, and description are required',
      );
    }
  }
});

test('the Item PATCH adapter preserves the merged JSON result and 404 response', async () => {
  const state = new InMemoryCatalogState();
  const application = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(state, [candidate]), {
      state,
      clock,
    }),
  );

  const updated = await updateAtlasItemResponse(application, candidate.id, {
    title: 'Edited title',
    description: 'Edited description',
    personalState: 'saved',
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), {
    ...candidate,
    title: 'Edited title',
    description: 'Edited description',
    personalState: 'saved',
    updatedAt: '2026-09-12T15:00:00.000Z',
    isFavorite: false,
    hasVisited: false,
  });

  const missing = await updateAtlasItemResponse(application, 'missing', {
    title: 'Edited title',
    description: 'Edited description',
    personalState: 'saved',
  });
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Atlas item not found');
});

test('the Items write adapters map dependency failures without leaking storage details', async () => {
  const state = {
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
      throw new Error('secret catalog insert');
    },
    async saveOverride() {
      throw new Error('secret override upsert');
    },
  };
  const application = createAtlasApplication(
    createCatalogOperationGroup(createCatalogRead(state, [candidate]), {
      state,
      clock,
    }),
  );

  const saveFailure = await saveDiscoveredItemResponse(application, candidate);
  assert.equal(saveFailure.status, 500);
  assert.equal(await saveFailure.text(), 'The Atlas item could not be saved.');

  const updateFailure = await updateAtlasItemResponse(
    application,
    candidate.id,
    {
      title: 'Edited title',
      description: 'Edited description',
      personalState: 'saved',
    },
  );
  assert.equal(updateFailure.status, 500);
  assert.equal(
    await updateFailure.text(),
    'The Atlas item could not be updated.',
  );
});
