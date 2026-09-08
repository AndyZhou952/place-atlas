import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertAllowedImage,
  maxMediaCaptionLength,
  normalizeMediaCaption,
} from './media-policy.ts';

test('accepts supported image signatures and rejects mismatches', () => {
  assert.doesNotThrow(() =>
    assertAllowedImage('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0x00])),
  );
  assert.doesNotThrow(() =>
    assertAllowedImage(
      'image/png',
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
  );
  assert.throws(() =>
    assertAllowedImage('image/png', Uint8Array.from([0xff, 0xd8, 0xff])),
  );
});

test('normalizes optional captions and enforces the one-line budget', () => {
  assert.equal(normalizeMediaCaption('  ramen  '), 'ramen');
  assert.equal(normalizeMediaCaption('dish\nname'), 'dish name');
  assert.equal(normalizeMediaCaption('   '), undefined);
  assert.throws(() =>
    normalizeMediaCaption('x'.repeat(maxMediaCaptionLength + 1)),
  );
});
