import assert from 'node:assert/strict';
import test from 'node:test';

import { attachVisitMediaResponse } from './media-write-response.ts';

test('Media POST sends stable IDs and bytes through one mutation envelope', async () => {
  let envelope;
  const request = mediaRequest({
    mutationId: 'media-batch-1',
    files: [image('sushi.jpg')],
    ids: ['media-1'],
    captions: ['  tuna   course  '],
  });
  const response = await attachVisitMediaResponse(
    coordinator(async (input) => {
      envelope = input;
      return okReceipt(input.mutationId, [{ id: 'media-1' }]);
    }),
    request,
  );

  assert.equal(response.status, 201);
  assert.equal((await response.json()).result[0].id, 'media-1');
  assert.equal(envelope.operation, 'media.attach');
  assert.equal(envelope.input.visitId, 'visit-1');
  assert.equal(envelope.input.uploads[0].id, 'media-1');
  assert.equal(envelope.input.uploads[0].caption, '  tuna   course  ');
  assert.deepEqual([...envelope.input.uploads[0].bytes], [0xff, 0xd8, 0xff]);
});

test('Media POST rejects missing mutation/file IDs and oversized batches before coordinator', async () => {
  let calls = 0;
  const fake = coordinator(async () => {
    calls += 1;
    throw new Error('must not run');
  });
  const noMutation = await attachVisitMediaResponse(
    fake,
    mediaRequest({ files: [image('one.jpg')], ids: ['media-1'] }),
  );
  const noFileId = await attachVisitMediaResponse(
    fake,
    mediaRequest({ mutationId: 'batch', files: [image('one.jpg')] }),
  );
  const tooMany = await attachVisitMediaResponse(
    fake,
    mediaRequest({
      mutationId: 'batch',
      files: Array.from({ length: 5 }, (_, index) => image(`${index}.jpg`)),
      ids: Array.from({ length: 5 }, (_, index) => `media-${index}`),
    }),
  );

  assert.equal(noMutation.status, 400);
  assert.equal(noFileId.status, 400);
  assert.equal(tooMany.status, 400);
  assert.equal(calls, 0);
});

function mediaRequest({ mutationId, files, ids = [], captions = [] }) {
  const form = new FormData();
  form.append('visitId', 'visit-1');
  files.forEach((file) => form.append('files', file));
  ids.forEach((id) => form.append('ids', id));
  captions.forEach((caption) => form.append('captions', caption));
  return new Request('https://atlas.example/api/media', {
    method: 'POST',
    headers: mutationId ? { 'x-atlas-mutation-id': mutationId } : undefined,
    body: form,
  });
}

function image(name) {
  return new File([Uint8Array.of(0xff, 0xd8, 0xff)], name, {
    type: 'image/jpeg',
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
