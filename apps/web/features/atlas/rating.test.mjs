import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRating, parseOptionalRating } from './rating.ts';

test('rounds free-form ratings to the nearest tenth', () => {
  assert.equal(normalizeRating(3.76), 3.8);
  assert.equal(normalizeRating(3.74), 3.7);
  assert.equal(normalizeRating(4.05), 4.1);
});

test('accepts both ends of the rating range', () => {
  assert.equal(normalizeRating(0), 0);
  assert.equal(normalizeRating(5), 5);
});

test('rejects non-finite and out-of-range values', () => {
  assert.throws(() => normalizeRating(Number.NaN), RangeError);
  assert.throws(() => normalizeRating(-0.1), RangeError);
  assert.throws(() => normalizeRating(5.1), RangeError);
});

test('keeps an empty optional rating empty', () => {
  assert.equal(parseOptionalRating(''), undefined);
  assert.equal(parseOptionalRating('  '), undefined);
  assert.equal(parseOptionalRating('3.76'), 3.8);
});
