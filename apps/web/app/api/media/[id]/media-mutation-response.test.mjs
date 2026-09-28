import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteVisitMediaResponse,
  updateVisitMediaCaptionResponse,
  updateVisitMediaScoreResponse,
} from './media-mutation-response.ts';

test('Media PATCH and DELETE emit mutation envelopes and receipt responses', async () => {
  const envelopes = [];
  const fake = coordinator(async (input) => {
    envelopes.push(input);
    return okReceipt(
      input.mutationId,
      input.operation === 'media.caption'
        ? { id: 'media-1', caption: 'chef choice' }
        : { id: 'media-1', deleted: true },
    );
  });
  const updated = await updateVisitMediaCaptionResponse(
    fake,
    mutationRequest('PATCH', 'caption-1'),
    'media-1',
    { caption: '  chef\nchoice  ' },
  );
  const deleted = await deleteVisitMediaResponse(
    fake,
    mutationRequest('DELETE', 'delete-1'),
    'media-1',
  );

  assert.equal((await updated.json()).result.caption, 'chef choice');
  assert.deepEqual((await deleted.json()).result, {
    id: 'media-1',
    deleted: true,
  });
  assert.deepEqual(
    envelopes.map(({ operation, mutationId }) => [operation, mutationId]),
    [
      ['media.caption', 'caption-1'],
      ['media.delete', 'delete-1'],
    ],
  );
});

test('Media mutations reject invalid input or missing mutation IDs before coordinator', async () => {
  let calls = 0;
  const fake = coordinator(async () => {
    calls += 1;
    throw new Error('must not run');
  });
  const invalid = await updateVisitMediaCaptionResponse(
    fake,
    mutationRequest('PATCH', 'caption-1'),
    'media-1',
    { caption: 42 },
  );
  const missingId = await deleteVisitMediaResponse(
    fake,
    new Request('https://atlas.example/api/media/media-1', {
      method: 'DELETE',
    }),
    'media-1',
  );
  const invalidScore = await updateVisitMediaScoreResponse(
    fake,
    mutationRequest('PATCH', 'score-1'),
    'media-1',
    { score: 5.1 },
  );
  const mixedFields = await updateVisitMediaScoreResponse(
    fake,
    mutationRequest('PATCH', 'score-2'),
    'media-1',
    { score: 4.2, caption: 'not in this mutation' },
  );

  assert.equal(invalid.status, 400);
  assert.equal(invalidScore.status, 400);
  assert.equal(mixedFields.status, 400);
  assert.equal(missingId.status, 400);
  assert.equal(calls, 0);
});

test('Media score PATCH emits its own atomic operation and clear value', async () => {
  const envelopes = [];
  const fake = coordinator(async (input) => {
    envelopes.push(input);
    return okReceipt(input.mutationId, { id: 'media-1', score: 4.2 });
  });
  const response = await updateVisitMediaScoreResponse(
    fake,
    mutationRequest('PATCH', 'score-1'),
    'media-1',
    { score: 4.2 },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.score, 4.2);
  assert.equal(envelopes[0].operation, 'media.score');
  assert.deepEqual(envelopes[0].input, { id: 'media-1', score: 4.2 });
});

function mutationRequest(method, mutationId) {
  return new Request('https://atlas.example/api/media/media-1', {
    method,
    headers: { 'x-atlas-mutation-id': mutationId },
  });
}

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
