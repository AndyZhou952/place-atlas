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

const candidate = {
  recordType: 'review_candidate',
  id: 'candidate-one',
  kind: 'food',
  title: 'Candidate one',
  description: 'Awaiting owner review',
  verificationStatus: 'needs_review',
  personalState: 'candidate',
  tags: [],
  reviewEvidence: {
    candidateIdentity: {
      providerNamespace: 'google_places',
      placeId: 'candidate-place-one',
    },
    ownerFields: { title: 'Candidate one' },
    locationEvidence: { status: 'unknown' },
    tabelog: { status: 'unknown' },
    reservation: { status: 'unknown' },
    unknownFields: ['address', 'coordinates', 'tabelog', 'reservation'],
    warnings: [{ code: 'needs_review', message: 'Owner review is required.' }],
  },
  updatedAt: '2026-09-23T12:00:00.000Z',
};

test('the anonymous Item GET exposes verified detail and hides Review Candidates as not found', async () => {
  const application = createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(
        new InMemoryCatalogState({
          dynamicPayloads: [JSON.stringify(candidate)],
          overrides: [],
          assessments: [],
          tombstoneIds: [],
          visitCounts: [],
        }),
        [item],
      ),
    ),
  );

  const [found, hiddenCandidate, missing] = await Promise.all([
    getAtlasItemResponse(application, item.id),
    getAtlasItemResponse(application, candidate.id),
    getAtlasItemResponse(application, 'missing'),
  ]);

  const { personalState: _personalState, ...publicItem } = item;
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), publicItem);
  assert.equal(hiddenCandidate.status, 404);
  assert.equal(await hiddenCandidate.text(), 'Atlas item not found');
  assert.equal(missing.status, 404);
});
