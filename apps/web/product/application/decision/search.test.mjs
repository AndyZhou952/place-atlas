import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createCatalogRead } from '../catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../catalog/in-memory-catalog-state.ts';
import { createDecisionOperationGroup } from './decision-operations.ts';

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
    tags: [],
    sources: [],
    ...overrides,
  };
}

test('catalog search preserves normalized multi-field tolerant matching over verified items', async () => {
  const onibus = item('onibus', {
    title: 'オニバスコーヒー・中目黒駅前店',
    alternateTitle: 'ONIBUS KOFFEE NAKAMEGURO',
    area: '中目黒',
    address: '東京都目黒区上目黒2-14-1',
    description: 'Specialty coffee by the station',
    tags: ['walk-in', 'cofee'],
  });
  const museum = item('museum', {
    kind: 'architecture',
    title: 'すみだ北斎美術館',
    alternateTitle: 'The Sumida Hokusai Museum',
    area: '両国',
    tags: ['architecture', 'museum'],
  });
  const unverified = item('candidate', {
    title: 'ONIBUS candidate',
    verificationStatus: 'needs_review',
  });
  const state = new InMemoryCatalogState({
    dynamicPayloads: [JSON.stringify(unverified)],
    overrides: [],
    assessments: [],
    tombstoneIds: [],
    visitCounts: [],
  });
  const application = createAtlasApplication(
    createDecisionOperationGroup(createCatalogRead(state, [onibus, museum])),
  );

  const queries = [
    '',
    'ＯＮＩＢＵＳ',
    '中目黒・駅前',
    'special',
    'coffee',
    'nakame walk',
  ];
  const results = await Promise.all(
    queries.map((query) =>
      application.execute({ key: 'catalog.search', input: { query } }),
    ),
  );

  assert.deepEqual(
    results.map((result) =>
      result.ok ? result.value.map((candidate) => candidate.id) : result,
    ),
    [
      ['onibus', 'museum'],
      ['onibus'],
      ['onibus'],
      ['onibus'],
      ['onibus'],
      ['onibus'],
    ],
  );
});

test('catalog search keeps the existing bigram tolerance for a misspelled token', async () => {
  const application = createAtlasApplication(
    createDecisionOperationGroup(
      createCatalogRead(new InMemoryCatalogState(), [
        item('sushi', { title: 'Sushi' }),
        item('ramen', { title: 'Ramen' }),
      ]),
    ),
  );

  const result = await application.execute({
    key: 'catalog.search',
    input: { query: 'susi' },
  });

  assert.deepEqual(
    result.ok ? result.value.map((candidate) => candidate.id) : result,
    ['sushi'],
  );
});
