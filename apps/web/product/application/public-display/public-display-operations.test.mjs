import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createCatalogRead } from '../catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../catalog/in-memory-catalog-state.ts';
import { InMemoryVisitMediaState } from '../media/media-read-memory.ts';
import { InMemoryPlaceAssessmentState } from '../assessments/in-memory-place-assessment-state.ts';
import { InMemoryVisitState } from '../visits/in-memory-visit-state.ts';
import { createPublicDisplayOperationGroup } from './public-display-operations.ts';

const item = {
  id: 'place-1',
  kind: 'food',
  title: 'Sushi',
  area: 'Ginza',
  address: 'Ginza, Tokyo',
  description: 'Counter sushi',
  latitude: 35.67,
  longitude: 139.76,
  verificationStatus: 'verified',
  verifiedAt: '2026-09-20',
  reservation: { mode: 'walk-in', label: 'Walk in', checkedAt: '2026-09-20' },
  personalState: 'candidate',
  tags: [],
  sources: [],
};

void test('assessment.display derives effective visited in the application operation', async () => {
  const application = createAtlasApplication(
    createPublicDisplayOperationGroup({
      catalog: createCatalogRead(new InMemoryCatalogState(), [item]),
      assessments: new InMemoryPlaceAssessmentState({
        assessments: [
          {
            itemId: item.id,
            overallRating: 4.4,
            isFavorite: true,
            manualVisited: false,
            summary: 'Return for lunch',
            updatedAt: 'private',
          },
        ],
        visitCounts: [{ itemId: item.id, count: 1 }],
      }),
      visits: new InMemoryVisitState(),
      media: new InMemoryVisitMediaState(),
    }),
  );

  const result = await application.execute({
    key: 'assessment.display',
    input: { itemId: item.id },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    itemId: item.id,
    isFavorite: true,
    manualVisited: false,
    effectiveVisited: true,
    overallRating: 4.4,
    summary: 'Return for lunch',
  });
});

void test('visit display operations assemble opaque media metadata without changing visit facts', async () => {
  const visit = {
    id: 'visit-1',
    itemId: item.id,
    itemTitle: item.title,
    visitedAt: '2026-09-20',
    note: 'Omakase',
    createdAt: 'private-created',
    updatedAt: 'private-updated',
  };
  const media = {
    id: 'internal-media-1',
    displayId: 'pm_opaque_1',
    visitId: visit.id,
    itemId: item.id,
    objectKey: 'private/object-key',
    originalFilename: 'IMG_0001.jpg',
    contentType: 'image/jpeg',
    byteSize: 123,
    contentSha256: 'private-hash',
    caption: 'Nigiri',
    displayOrder: 0,
    createdAt: 'private-created',
    updatedAt: 'private-updated',
  };
  const application = createAtlasApplication(
    createPublicDisplayOperationGroup({
      catalog: createCatalogRead(new InMemoryCatalogState(), [item]),
      assessments: new InMemoryPlaceAssessmentState(),
      visits: new InMemoryVisitState({ visits: [visit] }),
      media: new InMemoryVisitMediaState([media]),
    }),
  );

  const [listed, found, missing] = await Promise.all([
    application.execute({ key: 'visit.listDisplay', input: {} }),
    application.execute({ key: 'visit.getDisplay', input: { id: visit.id } }),
    application.execute({ key: 'visit.getDisplay', input: { id: 'missing' } }),
  ]);

  assert.equal(listed.ok, true);
  assert.deepEqual(listed.value, [{ ...visit, media: [media] }]);
  assert.equal(found.ok, true);
  assert.deepEqual(found.value, { ...visit, media: [media] });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.kind, 'not_found');
});

void test('public display authorizes assessment and Visit data only for verified Catalog items', async () => {
  const candidate = reviewCandidate('candidate-1');
  const candidateVisit = {
    id: 'candidate-visit',
    itemId: candidate.id,
    itemTitle: candidate.title,
    visitedAt: '2026-09-21',
    note: 'private candidate note',
    createdAt: 'private-created',
    updatedAt: 'private-updated',
  };
  const verifiedVisit = {
    ...candidateVisit,
    id: 'verified-visit',
    itemId: item.id,
    itemTitle: item.title,
    note: 'public verified note',
  };
  const media = [candidateVisit, verifiedVisit].map((visit) => ({
    id: `${visit.id}-media`,
    displayId: `pm_${visit.id}`,
    visitId: visit.id,
    itemId: visit.itemId,
    objectKey: `private/${visit.id}`,
    originalFilename: 'private.jpg',
    contentType: 'image/jpeg',
    byteSize: 1,
    contentSha256: 'private-hash',
    caption: `${visit.note} media`,
    displayOrder: 0,
    createdAt: 'private-created',
    updatedAt: 'private-updated',
  }));
  const catalog = createCatalogRead(
    new InMemoryCatalogState({
      dynamicPayloads: [JSON.stringify(candidate)],
      overrides: [],
      assessments: [],
      tombstoneIds: [],
      visitCounts: [],
    }),
    [item],
  );
  const application = createAtlasApplication(
    createPublicDisplayOperationGroup({
      catalog,
      assessments: new InMemoryPlaceAssessmentState({
        assessments: [
          {
            itemId: candidate.id,
            overallRating: 4.8,
            isFavorite: true,
            manualVisited: true,
            summary: 'private candidate summary',
            updatedAt: 'private',
          },
        ],
        visitCounts: [{ itemId: candidate.id, count: 1 }],
      }),
      visits: new InMemoryVisitState({
        visits: [candidateVisit, verifiedVisit],
      }),
      media: new InMemoryVisitMediaState(media),
    }),
  );

  const [assessment, visits, candidateDetail, verifiedDetail] =
    await Promise.all([
      application.execute({
        key: 'assessment.display',
        input: { itemId: candidate.id },
      }),
      application.execute({ key: 'visit.listDisplay', input: {} }),
      application.execute({
        key: 'visit.getDisplay',
        input: { id: candidateVisit.id },
      }),
      application.execute({
        key: 'visit.getDisplay',
        input: { id: verifiedVisit.id },
      }),
    ]);

  assert.equal(assessment.ok, false);
  assert.equal(assessment.error.kind, 'not_found');
  assert.equal(visits.ok, true);
  assert.deepEqual(
    visits.value.map(({ id, media: entries }) => ({
      id,
      media: entries.map(({ id: mediaId }) => mediaId),
    })),
    [{ id: verifiedVisit.id, media: [`${verifiedVisit.id}-media`] }],
  );
  assert.equal(candidateDetail.ok, false);
  assert.equal(candidateDetail.error.kind, 'not_found');
  assert.equal(verifiedDetail.ok, true);
  assert.equal(verifiedDetail.value.note, 'public verified note');
});

function reviewCandidate(id) {
  return {
    recordType: 'review_candidate',
    id,
    kind: 'food',
    title: 'Private candidate',
    description: 'Awaiting review',
    verificationStatus: 'needs_review',
    personalState: 'candidate',
    tags: [],
    reviewEvidence: {
      candidateIdentity: {
        providerNamespace: 'google_places',
        placeId: `place-${id}`,
      },
      ownerFields: { title: 'Private candidate' },
      locationEvidence: { status: 'unknown' },
      tabelog: { status: 'unknown' },
      reservation: { status: 'unknown' },
      unknownFields: ['address', 'coordinates'],
      warnings: [{ code: 'needs_review', message: 'Owner review required.' }],
    },
    updatedAt: '2026-09-23T12:00:00.000Z',
  };
}
