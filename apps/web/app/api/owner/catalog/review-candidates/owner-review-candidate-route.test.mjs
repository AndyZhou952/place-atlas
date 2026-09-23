import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../../../product/application/atlas-application.ts';
import { createCatalogReadOperationGroup } from '../../../../../product/application/catalog/catalog-operations.ts';
import { createCatalogRead } from '../../../../../product/application/catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../../../../../product/application/catalog/in-memory-catalog-state.ts';
import {
  createOwnerReviewCandidateDetailGet,
  createOwnerReviewCandidateListGet,
} from './owner-review-candidate-route.ts';

const candidate = reviewCandidate('candidate-one');

void test('anonymous or incorrect Owner credentials are rejected before Catalog composition', async () => {
  let compositions = 0;
  const GET = createOwnerReviewCandidateListGet({
    async authorizeOwnerRead() {
      return new Response('Owner login is required.', { status: 401 });
    },
    getApplication() {
      compositions += 1;
      throw new Error('must not compose');
    },
  });

  const response = await GET(
    new Request('https://atlas.example/api/owner/catalog/review-candidates'),
  );

  assert.equal(response.status, 401);
  assert.equal(compositions, 0);
});

void test('authenticated Owner list and detail expose a closed candidate DTO with explicit unknown location', async () => {
  const application = catalogApplication(candidate);
  const dependencies = {
    async authorizeOwnerRead() {
      return undefined;
    },
    getApplication() {
      return application;
    },
  };
  const list = createOwnerReviewCandidateListGet(dependencies);
  const detail = createOwnerReviewCandidateDetailGet(dependencies);

  const [listed, found, missing] = await Promise.all([
    list(
      new Request('https://atlas.example/api/owner/catalog/review-candidates'),
    ),
    detail(
      new Request(
        'https://atlas.example/api/owner/catalog/review-candidates/candidate-one',
      ),
      { params: Promise.resolve({ id: candidate.id }) },
    ),
    detail(
      new Request(
        'https://atlas.example/api/owner/catalog/review-candidates/missing',
      ),
      { params: Promise.resolve({ id: 'missing' }) },
    ),
  ]);

  const expected = {
    recordType: 'review_candidate',
    id: candidate.id,
    kind: 'food',
    title: 'Candidate place',
    description: 'Awaiting owner review',
    verificationStatus: 'needs_review',
    area: { status: 'unknown' },
    location: { status: 'unknown' },
    tabelog: { status: 'unknown' },
    reservation: { status: 'unknown' },
    unknownFields: ['address', 'coordinates', 'tabelog', 'reservation'],
    warnings: [{ code: 'needs_review', message: 'Owner review is required.' }],
    personalState: 'candidate',
    isFavorite: false,
    hasVisited: false,
    tags: [],
    updatedAt: '2026-09-23T12:00:00.000Z',
  };
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), [expected]);
  assert.equal(found.status, 200);
  assert.deepEqual(await found.json(), expected);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Review Candidate not found');
});

function catalogApplication(value) {
  return createAtlasApplication(
    createCatalogReadOperationGroup(
      createCatalogRead(
        new InMemoryCatalogState({
          dynamicPayloads: [JSON.stringify(value)],
          overrides: [],
          assessments: [],
          tombstoneIds: [],
          visitCounts: [],
        }),
        [],
      ),
    ),
  );
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
