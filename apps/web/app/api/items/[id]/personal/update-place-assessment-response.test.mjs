import assert from 'node:assert/strict';
import test from 'node:test';

import { updatePlaceAssessmentResponse } from './update-place-assessment-response.ts';

const request = new Request(
  'https://atlas.example/api/items/place-one/personal',
  {
    method: 'PATCH',
    headers: { 'x-atlas-mutation-id': 'assessment-1' },
  },
);

test('the personal HTTP adapter maps legacy hasVisited into one mutation envelope', async () => {
  let envelope;
  const item = {
    id: 'place-one',
    personalRating: 3.8,
    isFavorite: true,
    hasVisited: true,
    overallComment: 'Good',
  };
  const response = await updatePlaceAssessmentResponse(
    coordinator(async (input) => {
      envelope = input;
      return okReceipt(input.mutationId, { assessment: {}, item });
    }),
    request,
    item.id,
    {
      overallRating: 3.76,
      isFavorite: true,
      hasVisited: false,
      summary: '  Good  ',
    },
  );

  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.mutationId, 'assessment-1');
  assert.deepEqual(receipt.result.item, item);
  assert.deepEqual(envelope.operation, 'assessment.update');
  assert.deepEqual(envelope.input, {
    itemId: 'place-one',
    patch: {
      overallRating: 3.76,
      isFavorite: true,
      manualVisited: false,
      summary: '  Good  ',
    },
  });
  assert.equal(envelope.invocation.channel, 'web');
});

test('the personal HTTP adapter represents cleared optional values as explicit nulls', async () => {
  const response = await updatePlaceAssessmentResponse(
    coordinator(async (input) =>
      okReceipt(input.mutationId, {
        assessment: {
          itemId: 'place-one',
          isFavorite: false,
          manualVisited: false,
          updatedAt: '2026-09-24T09:00:00.000Z',
        },
        item: {
          id: 'place-one',
          isFavorite: false,
          hasVisited: false,
        },
      }),
    ),
    request,
    'place-one',
    { overallRating: null, summary: null },
  );

  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.result.item.personalRating, null);
  assert.equal(receipt.result.item.overallComment, null);
  assert.equal('personalRating' in receipt.result.item, true);
  assert.equal('overallComment' in receipt.result.item, true);
});

test('the personal adapter requires a mutation ID and preserves stable error statuses', async () => {
  let calls = 0;
  const missingId = await updatePlaceAssessmentResponse(
    coordinator(async () => {
      calls += 1;
      throw new Error('must not run');
    }),
    new Request(request.url, { method: 'PATCH' }),
    'place-one',
    { isFavorite: true },
  );
  const invalid = await updatePlaceAssessmentResponse(
    coordinator(async () => {
      calls += 1;
      throw new Error('must not run');
    }),
    request,
    'place-one',
    { overallRating: 6 },
  );
  const missing = await updatePlaceAssessmentResponse(
    coordinator(async () => ({
      ok: false,
      error: { kind: 'not_found', message: 'private detail' },
    })),
    request,
    'missing',
    { isFavorite: true },
  );

  assert.equal(missingId.status, 400);
  assert.equal(invalid.status, 400);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Atlas item not found');
  assert.equal(calls, 0);
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
