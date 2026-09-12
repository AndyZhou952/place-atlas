import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createMediaOperationGroup } from '../../../product/application/media/media-operations.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from '../../../product/application/media/media-read-memory.ts';
import { listVisitMediaResponse } from './list-visit-media-response.ts';

const metadata = {
  id: 'media-1',
  visitId: 'visit-1',
  itemId: 'item-1',
  objectKey: 'visits/visit-1/media-1',
  originalFilename: 'sushi.jpg',
  contentType: 'image/jpeg',
  byteSize: 123,
  contentSha256: 'hash-1',
  caption: '鮨',
  displayOrder: 0,
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
};

test('the Media GET adapter preserves query filters and JSON content URLs', async () => {
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState([metadata]),
      new InMemoryMediaObjectStore(),
    ),
  );

  const response = await listVisitMediaResponse(
    application,
    new Request(
      'https://atlas.example/api/media?visitId=visit-1&itemId=item-1',
    ),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    {
      id: 'media-1',
      visitId: 'visit-1',
      itemId: 'item-1',
      originalFilename: 'sushi.jpg',
      contentType: 'image/jpeg',
      byteSize: 123,
      contentSha256: 'hash-1',
      caption: '鮨',
      displayOrder: 0,
      contentUrl: '/api/media/media-1/content',
      createdAt: '2026-09-10T08:00:00.000Z',
      updatedAt: '2026-09-10T08:00:00.000Z',
    },
  ]);
});
