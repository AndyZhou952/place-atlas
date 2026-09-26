import assert from 'node:assert/strict';
import test from 'node:test';

import { createVisitResponse, updateVisitResponse } from './visit-responses.ts';

const request = new Request('https://atlas.example/api/journal', {
  method: 'POST',
  headers: { 'x-atlas-mutation-id': 'visit-mutation-1' },
});

test('Journal POST maps normalized input into a 201 mutation receipt', async () => {
  let envelope;
  const output = {
    visit: { id: 'visit-one', itemId: 'place-one' },
    item: { id: 'place-one', hasVisited: true },
  };
  const response = await createVisitResponse(
    coordinator(async (input) => {
      envelope = input;
      return okReceipt(input.mutationId, output);
    }),
    request,
    {
      id: ' visit-one ',
      itemId: 'place-one',
      visitedAt: '2026-09-12',
      rating: 3.76,
    },
  );

  assert.equal(response.status, 201);
  assert.equal((await response.json()).result.visit.id, 'visit-one');
  assert.equal(envelope.operation, 'visit.create');
  assert.deepEqual(envelope.input, {
    id: 'visit-one',
    itemId: 'place-one',
    visitedAt: '2026-09-12',
    rating: 3.76,
  });
});

test('Journal PATCH preserves update and rating-clear input semantics', async () => {
  let envelope;
  const response = await updateVisitResponse(
    coordinator(async (input) => {
      envelope = input;
      return okReceipt(input.mutationId, { item: { id: 'place-one' } });
    }),
    new Request('https://atlas.example/api/journal/visit-one', {
      method: 'PATCH',
      headers: { 'x-atlas-mutation-id': 'visit-update-1' },
    }),
    'visit-one',
    { visitedAt: '2026-09-13', note: '', rating: null },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).mutationId, 'visit-update-1');
  assert.deepEqual(envelope.input, {
    id: 'visit-one',
    visitedAt: '2026-09-13',
    note: '',
    rating: null,
  });
});

test('Journal writes require mutation IDs and preserve sanitized errors', async () => {
  let calls = 0;
  const noId = await createVisitResponse(
    coordinator(async () => {
      calls += 1;
      throw new Error('must not run');
    }),
    new Request(request.url, { method: 'POST' }),
    { itemId: 'place-one', visitedAt: '2026-09-12', rating: 4 },
  );
  const invalid = await createVisitResponse(
    coordinator(async () => {
      calls += 1;
      throw new Error('must not run');
    }),
    request,
    { itemId: 'place-one', visitedAt: '2026-09-12', rating: 6 },
  );
  const missing = await updateVisitResponse(
    coordinator(async () => ({
      ok: false,
      error: { kind: 'not_found', message: 'private state' },
    })),
    request,
    'missing',
    { visitedAt: '2026-09-12' },
  );

  assert.equal(noId.status, 400);
  assert.equal(invalid.status, 400);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Journal entry not found');
  assert.equal(calls, 0);
});

test('Journal POST allows date-only records for optional notes and photos', async () => {
  let envelope;
  const response = await createVisitResponse(
    coordinator(async (input) => {
      envelope = input;
      return okReceipt(input.mutationId, { visit: { id: 'date-only' } });
    }),
    request,
    { itemId: 'place-one', visitedAt: '2026-09-12' },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(envelope.input, {
    itemId: 'place-one',
    visitedAt: '2026-09-12',
  });
});

function coordinator(mutate) {
  return { mutate };
}

function okReceipt(mutationId, result) {
  return {
    ok: true,
    value: {
      mutationId,
      payloadDigest: 'a'.repeat(64),
      result,
      replayed: false,
    },
  };
}
