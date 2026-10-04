import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../../../product/application/atlas-application.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from '../../../../../product/application/media/media-read-memory.ts';
import { createMediaOperationGroup } from '../../../../../product/application/media/media-operations.ts';
import { openOwnerVisitMediaResponse } from './open-visit-media-response.ts';

void test('owner media content opens by internal ID without exposing filename or public caching', async () => {
  const metadata = {
    id: 'internal-media-1',
    displayId: 'pm_opaque-public-token',
    visitId: 'visit-1',
    itemId: 'item-1',
    objectKey: 'visits/visit-1/internal-media-1',
    originalFilename: 'private-name.jpg',
    contentType: 'image/jpeg',
    byteSize: 3,
    contentSha256: 'private-hash',
    displayOrder: 0,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2, 3));
      controller.close();
    },
  });
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState([metadata]),
      new InMemoryMediaObjectStore(
        new Map([[metadata.objectKey, { body, etag: 'private-etag' }]]),
      ),
    ),
  );

  const response = await openOwnerVisitMediaResponse(application, metadata.id);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('content-disposition'), 'inline');
  assert.equal(response.headers.get('etag'), null);
  assert.doesNotMatch(
    [...response.headers.values()].join(' '),
    /private-name/u,
  );
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    Uint8Array.of(1, 2, 3),
  );
});
