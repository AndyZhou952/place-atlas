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

test('Item DELETE preserves its existing JSON shape and closes dependency errors', async () => {
  const success = applicationResult({
    ok: true,
    value: { id: item.id, deleted: true },
  });
  const missing = applicationResult({
    ok: false,
    error: { kind: 'not_found', message: 'Atlas item not found.' },
  });
  const failing = applicationResult({
    ok: false,
    error: { kind: 'dependency_failure', message: 'secret D1 detail' },
  });

  const deleted = await deleteAtlasItemResponse(success, item.id);
  const notFound = await deleteAtlasItemResponse(missing, 'missing');
  const failed = await deleteAtlasItemResponse(failing, item.id);

  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { id: item.id, deleted: true });
  assert.equal(notFound.status, 404);
  assert.equal(await notFound.text(), 'Atlas item not found');
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /secret|D1/u);
});

function applicationResult(result) {
  return {
    async execute() {
      return result;
    },
  };
}

function mutationResult(result) {
  return {
    async mutate() {
      return result;
    },
  };
}
