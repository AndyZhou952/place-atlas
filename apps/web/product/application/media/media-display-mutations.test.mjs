import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from './media-read-memory.ts';
import { createMediaOperationGroup } from './media-operations.ts';

void test('owner caption and delete resolve an opaque display ID to the internal media ID', async () => {
  const metadata = {
    id: 'internal-media-1',
    displayId: 'pm_opaque-public-token',
    visitId: 'visit-1',
    itemId: 'item-1',
    objectKey: 'visits/visit-1/internal-media-1',
    originalFilename: 'private.jpg',
    contentType: 'image/jpeg',
    byteSize: 3,
    contentSha256: 'private-hash',
    displayOrder: 0,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
  const state = new InMemoryVisitMediaState([metadata]);
  const application = createAtlasApplication(
    createMediaOperationGroup(state, new InMemoryMediaObjectStore(), {
      clock: { now: () => '2026-09-21T00:00:00.000Z' },
      idSource: { nextId: () => 'unused-internal-id' },
      displayIdSource: { nextId: () => 'unused-display-id' },
      digest: async () => 'unused-hash',
    }),
  );

  const captioned = await application.execute({
    key: 'media.caption',
    input: { id: metadata.displayId, caption: '  owner note  ' },
  });
  assert.equal(captioned.ok, true);
  assert.equal(captioned.value.id, metadata.id);
  assert.equal(captioned.value.caption, 'owner note');

  const scored = await application.execute({
    key: 'media.score',
    input: { id: metadata.displayId, score: 4.26 },
  });
  assert.equal(scored.ok, true);
  assert.equal(scored.value.score, 4.3);
  assert.equal(scored.value.caption, 'owner note');

  const cleared = await application.execute({
    key: 'media.score',
    input: { id: metadata.displayId, score: null },
  });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.value.score, undefined);
  assert.equal((await state.find(metadata.id)).caption, 'owner note');

  const invalid = await application.execute({
    key: 'media.score',
    input: { id: metadata.displayId, score: 5.1 },
  });
  assert.equal(invalid.ok, false);

  const deleted = await application.execute({
    key: 'media.delete',
    input: { id: metadata.displayId },
  });
  assert.deepEqual(deleted, {
    ok: true,
    value: { id: metadata.id, deleted: true },
  });
  assert.equal(await state.find(metadata.id), undefined);
});
