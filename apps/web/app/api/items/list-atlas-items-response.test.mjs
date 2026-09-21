import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createCatalogReadOperationGroup } from '../../../product/application/catalog/catalog-operations.ts';
import { createCatalogRead } from '../../../product/application/catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../../../product/application/catalog/in-memory-catalog-state.ts';
import { listAtlasItemsResponse } from './list-atlas-items-response.ts';

const candidate = {
  id: 'candidate',
  kind: 'food',
  title: 'Candidate',
  area: 'Tokyo',
  address: 'Tokyo address',
  description: 'Needs review',
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

test('the Items GET adapter preserves the full merged JSON collection', async () => {
  const application = createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(new InMemoryCatalogState(), [candidate]),
    ),
  );

  const response = await listAtlasItemsResponse(application);

  const { personalState: _personalState, ...publicCandidate } = candidate;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [publicCandidate]);
});
