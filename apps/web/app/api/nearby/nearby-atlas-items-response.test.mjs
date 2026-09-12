import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createCatalogRead } from '../../../product/application/catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../../../product/application/catalog/in-memory-catalog-state.ts';
import { createDecisionOperationGroup } from '../../../product/application/decision/decision-operations.ts';
import { nearbyAtlasItemsResponse } from './nearby-atlas-items-response.ts';

function item(index, overrides = {}) {
  return {
    id: `item-${index}`,
    kind: 'food',
    title: `Title ${index}`,
    area: 'Tokyo',
    address: 'Tokyo address',
    description: `Description ${index}`,
    latitude: 35.68 + index * 0.001,
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
    ...overrides,
  };
}

function application(items) {
  return createAtlasApplication(
    createDecisionOperationGroup(
      createCatalogRead(new InMemoryCatalogState(), items),
    ),
  );
}

test('the Nearby GET adapter defaults to five verified Atlas items', async () => {
  const response = await nearbyAtlasItemsResponse(
    application(Array.from({ length: 6 }, (_, index) => item(index))),
    new URLSearchParams({ lat: '35.68', lon: '139.76' }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).map((candidate) => candidate.id),
    ['item-0', 'item-1', 'item-2', 'item-3', 'item-4'],
  );
});

test('the Nearby GET adapter preserves limit normalization from one to twenty', async () => {
  const atlasApplication = application(
    Array.from({ length: 21 }, (_, index) => item(index)),
  );
  const limits = ['1', '20', '99', '-3', 'n/a', '0'];
  const responses = await Promise.all(
    limits.map((limit) =>
      nearbyAtlasItemsResponse(
        atlasApplication,
        new URLSearchParams({ lat: '35.68', lon: '139.76', limit }),
      ),
    ),
  );

  assert.deepEqual(
    await Promise.all(
      responses.map(async (response) => (await response.json()).length),
    ),
    [1, 20, 20, 1, 5, 5],
  );
});

test('the Nearby GET adapter rejects missing, invalid, or out-of-range coordinates', async () => {
  const atlasApplication = application([]);
  const invalidQueries = [
    { lon: '139.76' },
    { lat: '35.68' },
    { lat: '', lon: '139.76' },
    { lat: '   ', lon: '139.76' },
    { lat: '35.68', lon: '' },
    { lat: '35.68', lon: '   ' },
    { lat: 'not-a-number', lon: '139.76' },
    { lat: '35.68', lon: 'not-a-number' },
    { lat: '91', lon: '139.76' },
    { lat: '35.68', lon: '181' },
  ];
  const responses = await Promise.all(
    invalidQueries.map((query) =>
      nearbyAtlasItemsResponse(atlasApplication, new URLSearchParams(query)),
    ),
  );

  assert.deepEqual(
    await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: await response.text(),
      })),
    ),
    invalidQueries.map(() => ({
      status: 400,
      body: 'Valid lat and lon query parameters are required',
    })),
  );
});

test('the Nearby GET adapter keeps verified as default and allows only the explicit full merged profile', async () => {
  const verified = item(0);
  const needsReview = item(1, {
    id: 'review-item',
    verificationStatus: 'needs_review',
  });
  const state = new InMemoryCatalogState({
    dynamicPayloads: [JSON.stringify(needsReview)],
    overrides: [],
    assessments: [],
    tombstoneIds: [],
    visitCounts: [],
  });
  const atlasApplication = createAtlasApplication(
    createDecisionOperationGroup(createCatalogRead(state, [verified])),
  );

  const baseline = await nearbyAtlasItemsResponse(
    atlasApplication,
    new URLSearchParams({ lat: '35.68', lon: '139.76' }),
  );
  const full = await nearbyAtlasItemsResponse(
    atlasApplication,
    new URLSearchParams({
      lat: '35.68',
      lon: '139.76',
      profile: 'full_merged_catalog',
    }),
  );
  const invalid = await nearbyAtlasItemsResponse(
    atlasApplication,
    new URLSearchParams({
      lat: '35.68',
      lon: '139.76',
      profile: 'needs_review_only',
    }),
  );

  assert.deepEqual(
    (await baseline.json()).map((candidate) => candidate.id),
    [verified.id],
  );
  assert.deepEqual(
    (await full.json()).map((candidate) => candidate.id),
    [verified.id, needsReview.id],
  );
  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), 'A valid catalog profile is required');
});
