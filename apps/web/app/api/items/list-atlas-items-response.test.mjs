import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createCatalogReadOperationGroup } from '../../../product/application/catalog/catalog-operations.ts';
import { createCatalogRead } from '../../../product/application/catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../../../product/application/catalog/in-memory-catalog-state.ts';
import { listAtlasItemsResponse } from './list-atlas-items-response.ts';

const verified = atlasItem('verified');
const candidate = reviewCandidate('candidate');

test('the anonymous Items GET remains 200 and exposes only verified Catalog entries when a Review Candidate exists', async () => {
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
        [verified],
      ),
    ),
  );

  const response = await listAtlasItemsResponse(application);

  const { personalState: _personalState, ...publicVerified } = verified;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [publicVerified]);
});

function atlasItem(id) {
  return {
    id,
    kind: 'food',
    title: 'Verified place',
    area: 'Tokyo',
    address: 'Tokyo address',
    description: 'Verified',
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
}

function reviewCandidate(id) {
  return {
    recordType: 'review_candidate',
    id,
    kind: 'food',
    title: 'Candidate place',
    description: 'Awaiting owner review',
    verificationStatus: 'needs_review',
    personalState: 'candidate',
    tags: [],
    reviewEvidence: {
      candidateIdentity: {
        providerNamespace: 'google_places',
        placeId: `place-${id}`,
      },
      ownerFields: { title: 'Candidate place' },
      locationEvidence: { status: 'unknown' },
      tabelog: { status: 'unknown' },
      reservation: { status: 'unknown' },
      unknownFields: ['address', 'coordinates', 'tabelog', 'reservation'],
      warnings: [
        { code: 'needs_review', message: 'Owner review is required.' },
      ],
    },
    updatedAt: '2026-09-23T12:00:00.000Z',
  };
}
