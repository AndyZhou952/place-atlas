import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../../../product/application/atlas-application.ts';
import { createMediaOperationGroup } from '../../../../../product/application/media/media-operations.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from '../../../../../product/application/media/media-read-memory.ts';
import { openVisitMediaResponse } from './open-visit-media-response.ts';

const metadata = {
  id: 'media-1',
  displayId: 'pm_media-1',
  visitId: 'visit-1',
  itemId: 'item-1',
  objectKey: 'visits/visit-1/media-1',
  originalFilename: 'sushi.jpg',
  contentType: 'image/jpeg',
  byteSize: 3,
  contentSha256: 'hash-1',
  displayOrder: 0,
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
};

test('the media content adapter preserves bytes and emits fixed public headers', async () => {
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
        new Map([[metadata.objectKey, { body, etag: '"etag-1"' }]]),
      ),
    ),
  );

  const response = await openVisitMediaResponse(
    application,
    metadata.displayId,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(response.headers.get('content-disposition'), 'inline');
  assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('etag'), null);
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    Uint8Array.of(1, 2, 3),
  );
});

test('the media content adapter maps missing metadata and objects separately', async () => {
  const missingMetadataApplication = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState(),
      new InMemoryMediaObjectStore(),
    ),
  );
  const missingObjectApplication = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState([metadata]),
      new InMemoryMediaObjectStore(),
    ),
  );

  const missingMetadata = await openVisitMediaResponse(
    missingMetadataApplication,
    'pm_missing',
  );
  const missingObject = await openVisitMediaResponse(
    missingObjectApplication,
    metadata.displayId,
  );

  assert.equal(missingMetadata.status, 404);
  assert.equal(await missingMetadata.text(), 'Photo not found');
  assert.equal(missingObject.status, 500);
  assert.equal(await missingObject.text(), 'Photo content is unavailable');
});

test('cancelling the HTTP response body cancels the storage stream', async () => {
  let cancellations = 0;
  const body = new ReadableStream({
    cancel() {
      cancellations += 1;
    },
  });
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState([metadata]),
      new InMemoryMediaObjectStore(new Map([[metadata.objectKey, { body }]])),
    ),
  );

  const response = await openVisitMediaResponse(
    application,
    metadata.displayId,
  );
  await response.body.cancel('transport aborted');

  assert.equal(cancellations, 1);
});
