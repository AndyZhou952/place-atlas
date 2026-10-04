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

test('full catalog profile requires Owner auth and exposes review candidates only to the authorized request', async () => {
  const { listAtlasItemsForRequest } =
    await import('./list-atlas-items-response.ts');
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
  const request = new Request(
    'https://atlas.test/api/items?profile=full_merged_catalog',
  );
  const denied = await listAtlasItemsForRequest(
    request,
    application,
    async () => new Response('Owner login required', { status: 401 }),
  );
  assert.equal(denied.status, 401);
  const accepted = await listAtlasItemsForRequest(
    request,
    application,
    async () => undefined,
  );
  assert.equal(accepted.status, 200);
  const items = await accepted.json();
  assert.equal(items.length, 2);
  const review = items.find((item) => item.id === candidate.id);
  assert.equal(review.verificationStatus, 'needs_review');
  assert.equal(review.address, '');
  assert.equal(review.verifiedAt, undefined);
  assert.deepEqual(review.reservation, { status: 'unknown' });
  assert.equal(JSON.stringify(review).includes('ownerFields'), false);
  const invalid = await listAtlasItemsForRequest(
    new Request('https://atlas.test/api/items?profile=private'),
    application,
    async () => {
      throw new Error('Should not authorize invalid profile');
    },
  );
  assert.equal(invalid.status, 400);
});
