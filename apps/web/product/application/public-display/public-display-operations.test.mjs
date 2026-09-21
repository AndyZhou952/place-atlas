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
