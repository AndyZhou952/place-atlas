import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../../product/application/atlas-application.ts';
import { createMediaOperationGroup } from '../../../../product/application/media/media-operations.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from '../../../../product/application/media/media-read-memory.ts';
import {
  deleteVisitMediaResponse,
  updateVisitMediaCaptionResponse,
} from './media-mutation-response.ts';

const metadata = {
  id: 'media-1',
  visitId: 'visit-1',
  itemId: 'item-1',
  objectKey: 'visits/visit-1/media-1',
  originalFilename: 'sushi.jpg',
  contentType: 'image/jpeg',
  byteSize: 3,
  contentSha256: 'sha-1',
  displayOrder: 0,
  createdAt: '2026-09-11T08:00:00.000Z',
  updatedAt: '2026-09-11T08:00:00.000Z',
};
const dependencies = {
  clock: { now: () => '2026-09-12T08:00:00.000Z' },
  idSource: { nextId: () => 'unused' },
  digest: async () => 'unused',
};

test('Media PATCH and DELETE adapters preserve response shapes', async () => {
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState([metadata]),
      new InMemoryMediaObjectStore(
        new Map([
          [
            metadata.objectKey,
            { body: new ReadableStream(), etag: '"etag-1"' },
          ],
        ]),
      ),
      dependencies,
    ),
  );

  const updated = await updateVisitMediaCaptionResponse(
    application,
    'media-1',
    { caption: '  chef\nchoice  ' },
  );
  const deleted = await deleteVisitMediaResponse(application, 'media-1');

  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).caption, 'chef choice');
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { id: 'media-1', deleted: true });
});

test('Media mutation adapters preserve invalid-caption and not-found responses', async () => {
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState(),
      new InMemoryMediaObjectStore(),
      dependencies,
    ),
  );

  const invalid = await updateVisitMediaCaptionResponse(
    application,
    'media-1',
    { caption: 42 },
  );
  const missingUpdate = await updateVisitMediaCaptionResponse(
    application,
    'media-1',
    { caption: 'missing' },
  );
  const missingDelete = await deleteVisitMediaResponse(application, 'media-1');

  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), 'Caption must be text.');
  assert.equal(missingUpdate.status, 404);
  assert.equal(await missingUpdate.text(), 'Photo not found');
  assert.equal(missingDelete.status, 404);
  assert.equal(await missingDelete.text(), 'Photo not found');
});

test('Media PATCH preserves the baseline 400 mapping for a sanitized dependency failure', async () => {
  const application = createAtlasApplication(
    createMediaOperationGroup(
      {
        async list() {
          return [];
        },
        async find() {
          return undefined;
        },
        async getVisitContext() {
          return undefined;
        },
        async insert() {},
        async updateCaption() {
          throw new Error('secret D1 failure');
        },
        async delete() {
          return undefined;
        },
      },
      new InMemoryMediaObjectStore(),
      dependencies,
    ),
  );

  const response = await updateVisitMediaCaptionResponse(
    application,
    'media-1',
    { caption: 'course' },
  );

  assert.equal(response.status, 400);
  assert.equal(
    await response.text(),
    'The photo caption could not be updated.',
  );
});
