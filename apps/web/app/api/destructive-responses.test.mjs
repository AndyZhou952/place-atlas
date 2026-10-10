import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteAtlasItemResponse,
  deleteVisitResponse,
} from './destructive-responses.ts';

const item = {
  id: 'place-one',
  kind: 'food',
  title: 'Place one',
  area: 'Tokyo',
  address: 'Tokyo address',
  description: 'Description',
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
  isFavorite: false,
  hasVisited: false,
};

test('Journal DELETE returns a mutation receipt and preserves status mapping', async () => {
  const request = new Request('https://atlas.example/api/journal/visit-one', {
    method: 'DELETE',
    headers: { 'x-atlas-mutation-id': 'delete-visit-one' },
  });
  const success = mutationResult({
    ok: true,
    value: {
      mutationId: 'delete-visit-one',
      payloadDigest: 'a'.repeat(64),
      result: { item },
      replayed: false,
    },
  });
  const missing = mutationResult({
    ok: false,
    error: { kind: 'not_found', message: 'Journal entry not found.' },
  });

  const deleted = await deleteVisitResponse(success, request, 'visit-one');
  const invalid = await deleteVisitResponse(success, request, '');
  const notFound = await deleteVisitResponse(missing, request, 'missing');

  assert.equal(deleted.status, 200);
  assert.deepEqual((await deleted.json()).result, { item });
  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), 'Journal entry ID is required');
  assert.equal(notFound.status, 404);
  assert.equal(await notFound.text(), 'Journal entry not found');
});

test('Item DELETE returns a mutation receipt and closes dependency errors', async () => {
  const request = new Request('https://atlas.example/api/items/place-one', {
    method: 'DELETE',
    headers: { 'x-atlas-mutation-id': 'delete-place-one' },
  });
  const success = mutationResult({
    ok: true,
    value: {
      mutationId: 'delete-place-one',
      payloadDigest: 'a'.repeat(64),
      result: { id: item.id, deleted: true },
      replayed: false,
    },
  });
  const missing = mutationResult({
    ok: false,
    error: { kind: 'not_found', message: 'Atlas item not found.' },
  });
  const failing = mutationResult({
    ok: false,
    error: { kind: 'dependency_failure', message: 'secret D1 detail' },
  });

  const deleted = await deleteAtlasItemResponse(success, request, item.id);
  const notFound = await deleteAtlasItemResponse(missing, request, 'missing');
  const failed = await deleteAtlasItemResponse(failing, request, item.id);
  const invalid = await deleteAtlasItemResponse(success, request, '');

  assert.equal(deleted.status, 200);
  assert.deepEqual((await deleted.json()).result, {
    id: item.id,
    deleted: true,
  });
  assert.equal(invalid.status, 400);
  assert.equal(notFound.status, 404);
  assert.equal(await notFound.text(), 'Atlas item not found');
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /secret|D1/u);
});

test('Item DELETE rejects a missing mutation ID before invoking deletion', async () => {
  let mutations = 0;
  const response = await deleteAtlasItemResponse(
    {
      async mutate() {
        mutations += 1;
      },
    },
    new Request('https://atlas.example/api/items/place-one', {
      method: 'DELETE',
    }),
    item.id,
  );
  assert.equal(response.status, 400);
  assert.equal(mutations, 0);
});

function mutationResult(result) {
  return {
    async mutate() {
      return result;
    },
  };
}
