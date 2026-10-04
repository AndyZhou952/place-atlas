import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chunkMediaSelection,
  maxMediaFilesPerRequest,
  maxMediaFilesPerSelection,
} from './media-constraints.ts';

test('chunks an omakase-sized photo selection into bounded requests', () => {
  const photos = Array.from({ length: 18 }, (_, index) => index + 1);
  const chunks = chunkMediaSelection(photos);

  assert.equal(maxMediaFilesPerSelection >= photos.length, true);
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [4, 4, 4, 4, 2],
  );
  assert.equal(
    chunks.every((chunk) => chunk.length <= maxMediaFilesPerRequest),
    true,
  );
  assert.deepEqual(chunks.flat(), photos);
});

test('rejects invalid upload chunk sizes', () => {
  assert.throws(() => chunkMediaSelection([1], 0));
  assert.throws(() => chunkMediaSelection([1], 1.5));
});
