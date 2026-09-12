import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createMediaOperationGroup } from '../../../product/application/media/media-operations.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from '../../../product/application/media/media-read-memory.ts';
import { attachVisitMediaResponse } from './media-write-response.ts';

const dependencies = {
  clock: { now: () => '2026-09-12T08:00:00.000Z' },
  idSource: { nextId: () => 'media-1' },
  digest: async () => 'sha-1',
};

test('the Media POST adapter preserves the 201 JSON response', async () => {
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState(
        [],
        new Map([['visit-1', { itemId: 'item-1' }]]),
      ),
      new InMemoryMediaObjectStore(),
      dependencies,
    ),
  );
  const form = new FormData();
  form.append('visitId', 'visit-1');
  form.append(
    'files',
    new File([Uint8Array.of(0xff, 0xd8, 0xff)], 'sushi.jpg', {
      type: 'image/jpeg',
    }),
  );
  form.append('captions', '  tuna   course  ');

  const response = await attachVisitMediaResponse(
    application,
    new Request('https://atlas.example/api/media', {
      method: 'POST',
      body: form,
    }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), [
    {
      id: 'media-1',
      visitId: 'visit-1',
      itemId: 'item-1',
      originalFilename: 'sushi.jpg',
      contentType: 'image/jpeg',
      byteSize: 3,
      contentSha256: 'sha-1',
      caption: 'tuna course',
      displayOrder: 0,
      contentUrl: '/api/media/media-1/content',
      createdAt: '2026-09-12T08:00:00.000Z',
      updatedAt: '2026-09-12T08:00:00.000Z',
    },
  ]);
});

test('the Media POST adapter rejects more than four files per request', async () => {
  let calls = 0;
  const application = {
    async execute() {
      calls += 1;
      throw new Error('must not execute');
    },
  };
  const form = new FormData();
  form.append('visitId', 'visit-1');
  for (let index = 0; index < 5; index += 1) {
    form.append(
      'files',
      new File([Uint8Array.of(0xff, 0xd8, 0xff)], `${index}.jpg`, {
        type: 'image/jpeg',
      }),
    );
  }

  const response = await attachVisitMediaResponse(
    application,
    new Request('https://atlas.example/api/media', {
      method: 'POST',
      body: form,
    }),
  );

  assert.equal(response.status, 400);
  assert.equal(
    await response.text(),
    'Upload no more than 4 images in one request.',
  );
  assert.equal(calls, 0);
});

test('the Media POST adapter preserves validation and missing-Visit errors', async () => {
  const application = createAtlasApplication(
    createMediaOperationGroup(
      new InMemoryVisitMediaState(),
      new InMemoryMediaObjectStore(),
      dependencies,
    ),
  );
  const form = new FormData();
  form.append('visitId', 'missing-visit');
  form.append(
    'files',
    new File([Uint8Array.of(0xff, 0xd8, 0xff)], 'wrong.png', {
      type: 'image/png',
    }),
  );
  const invalid = await attachVisitMediaResponse(
    application,
    new Request('https://atlas.example/api/media', {
      method: 'POST',
      body: form,
    }),
  );

  assert.equal(invalid.status, 404);
  assert.equal(await invalid.text(), 'Journal entry not found');

  const missingForm = new FormData();
  missingForm.append('visitId', 'missing-visit');
  const missingFile = await attachVisitMediaResponse(
    application,
    new Request('https://atlas.example/api/media', {
      method: 'POST',
      body: missingForm,
    }),
  );
  assert.equal(missingFile.status, 400);
  assert.equal(
    await missingFile.text(),
    'A Visit and at least one image are required.',
  );
});
