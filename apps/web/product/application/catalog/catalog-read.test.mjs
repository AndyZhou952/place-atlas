import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createCatalogReadOperationGroup } from './catalog-operations.ts';
import { createCatalogRead } from './catalog-read.ts';
import { InMemoryCatalogState } from './in-memory-catalog-state.ts';

function item(id, overrides = {}) {
  return {
    id,
    kind: 'food',
    title: `Title ${id}`,
    alternateTitle: `Alternate ${id}`,
    area: 'Tokyo',
    address: 'Tokyo address',
    description: `Description ${id}`,
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
    tags: ['coffee'],
    sources: [],
    ...overrides,
  };
}

test('the full catalog merges records and excludes malformed or tombstoned items', async () => {
  const dynamicItem = item('dynamic', {
    verificationStatus: 'needs_review',
  });
  const replacedStaticItem = item('static', {
    title: 'Dynamic replacement',
    verificationStatus: 'needs_review',
  });
  const application = createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(
        new InMemoryCatalogState({
          dynamicPayloads: [
            JSON.stringify(dynamicItem),
            JSON.stringify(replacedStaticItem),
            '{not json',
            JSON.stringify({ id: 'incomplete' }),
            JSON.stringify(item('malformed-nested', { officialUrl: 42 })),
          ],
          overrides: [
            {
              itemId: 'static',
              title: 'Edited title',
              description: 'Edited description',
              personalState: 'planned',
              updatedAt: '2026-09-12T01:00:00.000Z',
            },
          ],
          assessments: [
            {
              itemId: 'static',
              overallRating: 4.2,
              isFavorite: true,
              manualVisited: false,
            },
          ],
          tombstoneIds: ['removed'],
          visitCounts: [{ itemId: 'static', count: 1 }],
        }),
        [item('static'), item('removed')],
      ),
    ),
  );

  const result = await application.execute({
    key: 'catalog.list',
    input: { profile: 'full_merged_catalog' },
  });

  assert.deepEqual(result, {
    ok: true,
    value: [
      {
        ...replacedStaticItem,
        title: 'Edited title',
        description: 'Edited description',
        personalState: 'planned',
        updatedAt: '2026-09-12T01:00:00.000Z',
        personalRating: 4.2,
        isFavorite: true,
        hasVisited: true,
      },
      {
        ...dynamicItem,
        personalRating: undefined,
        isFavorite: false,
        hasVisited: false,
      },
    ],
  });
});

test('the verified profile excludes needs-review records after merging', async () => {
  const application = createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(new InMemoryCatalogState(), [
        item('verified'),
        item('candidate', { verificationStatus: 'needs_review' }),
      ]),
    ),
  );

  const result = await application.execute({
    key: 'catalog.list',
    input: { profile: 'verified_catalog' },
  });

  assert.deepEqual(
    result.ok ? result.value.map((candidate) => candidate.id) : result,
    ['verified'],
  );
});

test('catalog state failures become a sanitized dependency error', async () => {
  const application = createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(
        {
          async readSnapshot() {
            throw new Error('private D1 binding detail');
          },
        },
        [],
      ),
    ),
  );

  assert.deepEqual(
    await application.execute({
      key: 'catalog.list',
      input: { profile: 'full_merged_catalog' },
    }),
    {
      ok: false,
      error: {
        kind: 'dependency_failure',
        message: 'Atlas items are temporarily unavailable.',
      },
    },
  );
});

test('catalog.get returns the merged item and closed failures through AtlasApplication', async () => {
  const target = item('target', { verificationStatus: 'needs_review' });
  const application = createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(
        new InMemoryCatalogState({
          dynamicPayloads: [
            JSON.stringify(target),
            JSON.stringify({ id: 'malformed' }),
          ],
          overrides: [],
          assessments: [],
          tombstoneIds: ['removed'],
          visitCounts: [],
        }),
        [item('removed')],
      ),
    ),
  );
  const failingApplication = createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(
        {
          async readSnapshot() {
            throw new Error('private D1 binding detail');
          },
        },
        [],
      ),
    ),
  );

  const results = await Promise.all([
    application.execute({ key: 'catalog.get', input: { id: 'target' } }),
    application.execute({ key: 'catalog.get', input: { id: 'removed' } }),
    application.execute({ key: 'catalog.get', input: { id: 'malformed' } }),
    application.execute({ key: 'catalog.get', input: { id: 'missing' } }),
    application.execute({ key: 'catalog.get', input: { id: '' } }),
    failingApplication.execute({
      key: 'catalog.get',
      input: { id: 'target' },
    }),
  ]);

  assert.deepEqual(results, [
    {
      ok: true,
      value: {
        ...target,
        personalRating: undefined,
        isFavorite: false,
        hasVisited: false,
      },
    },
    {
      ok: false,
      error: { kind: 'not_found', message: 'Atlas item not found.' },
    },
    {
      ok: false,
      error: { kind: 'not_found', message: 'Atlas item not found.' },
    },
    {
      ok: false,
      error: { kind: 'not_found', message: 'Atlas item not found.' },
    },
    {
      ok: false,
      error: {
        kind: 'invalid_input',
        message: 'An Atlas item ID is required.',
      },
    },
    {
      ok: false,
      error: {
        kind: 'dependency_failure',
        message: 'Atlas items are temporarily unavailable.',
      },
    },
  ]);
});
