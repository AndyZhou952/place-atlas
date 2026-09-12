import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createCatalogRead } from '../catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../catalog/in-memory-catalog-state.ts';
import { createDecisionOperationGroup } from './decision-operations.ts';

function item(id, latitude, longitude, overrides = {}) {
  return {
    id,
    kind: 'food',
    title: `Title ${id}`,
    area: 'Tokyo',
    address: 'Tokyo address',
    description: `Description ${id}`,
    latitude,
    longitude,
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

test('nearby profiles use the requested catalog and preserve catalog order for equal distances', async () => {
  const first = item('first', 35.69, 139.76);
  const second = item('second', 35.69, 139.76);
  const candidate = item('candidate', 35.68, 139.76, {
    verificationStatus: 'needs_review',
  });
  const application = createAtlasApplication(
    createDecisionOperationGroup(
      createCatalogRead(new InMemoryCatalogState(), [first, second, candidate]),
    ),
  );

  const [verified, full] = await Promise.all([
    application.execute({
      key: 'decision.nearby',
      input: {
        latitude: 35.68,
        longitude: 139.76,
        limit: 20,
        profile: 'verified_catalog',
      },
    }),
    application.execute({
      key: 'decision.nearby',
      input: {
        latitude: 35.68,
        longitude: 139.76,
        limit: 20,
        profile: 'full_merged_catalog',
      },
    }),
  ]);

  assert.deepEqual(
    [verified, full].map((result) =>
      result.ok ? result.value.map((nearby) => nearby.id) : result,
    ),
    [
      ['first', 'second'],
      ['candidate', 'first', 'second'],
    ],
  );
});

test('nearby validates coordinate boundaries and limits through AtlasApplication', async () => {
  const application = createAtlasApplication(
    createDecisionOperationGroup(
      createCatalogRead(new InMemoryCatalogState(), []),
    ),
  );
  const inputs = [
    { latitude: -90, longitude: -180, limit: 1 },
    { latitude: 90, longitude: 180, limit: 20 },
    { latitude: -90.1, longitude: 0, limit: 5 },
    { latitude: 0, longitude: 180.1, limit: 5 },
    { latitude: 0, longitude: 0, limit: 0 },
    { latitude: 0, longitude: 0, limit: 21 },
  ];

  const results = await Promise.all(
    inputs.map((input) =>
      application.execute({
        key: 'decision.nearby',
        input: { ...input, profile: 'verified_catalog' },
      }),
    ),
  );

  assert.deepEqual(
    results.map((result) => (result.ok ? 'ok' : result.error.kind)),
    [
      'ok',
      'ok',
      'invalid_input',
      'invalid_input',
      'invalid_input',
      'invalid_input',
    ],
  );
});

test('the full nearby profile is independent of personal and UI filtering state', async () => {
  const application = createAtlasApplication(
    createDecisionOperationGroup(
      createCatalogRead(new InMemoryCatalogState(), [
        item('unvisited-candidate', 35.68, 139.76, {
          verificationStatus: 'needs_review',
          isFavorite: false,
          hasVisited: false,
        }),
      ]),
    ),
  );

  const result = await application.execute({
    key: 'decision.nearby',
    input: {
      latitude: 35.68,
      longitude: 139.76,
      limit: 5,
      profile: 'full_merged_catalog',
      isFavorite: true,
      personalState: 'visited',
    },
  });

  assert.deepEqual(
    result.ok ? result.value.map((candidate) => candidate.id) : result,
    ['unvisited-candidate'],
  );
});
