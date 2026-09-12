import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../../product/application/atlas-application.ts';
import { createCatalogReadOperationGroup } from '../../../../product/application/catalog/catalog-operations.ts';
import { createCatalogRead } from '../../../../product/application/catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../../../../product/application/catalog/in-memory-catalog-state.ts';
import { getAtlasItemResponse } from './get-atlas-item-response.ts';

const item = {
  id: 'item/one',
  kind: 'food',
  title: 'Item one',
  area: 'Tokyo',
  address: 'Tokyo address',
  description: 'Description',
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

test('the Item GET adapter maps a merged item and not_found without duplicating catalog rules', async () => {
  const application = createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(new InMemoryCatalogState(), [item]),
    ),
  );

  const [found, missing] = await Promise.all([
    getAtlasItemResponse(application, item.id),
    getAtlasItemResponse(application, 'missing'),
  ]);

  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), {
    ...item,
    isFavorite: false,
    hasVisited: false,
  });
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Atlas item not found');
});
