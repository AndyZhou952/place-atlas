import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesPersonalStatus } from './personal-filter.ts';

const favoriteVisited = { isFavorite: true, hasVisited: true };
const favoriteNotYet = { isFavorite: true, hasVisited: false };
const visitedOnly = { isFavorite: false, hasVisited: true };
const notYetOnly = { isFavorite: false, hasVisited: false };

test('favorite alone returns every favorite place', () => {
  assert.equal(matchesPersonalStatus(favoriteVisited, 'all', true), true);
  assert.equal(matchesPersonalStatus(favoriteNotYet, 'all', true), true);
  assert.equal(matchesPersonalStatus(visitedOnly, 'all', true), false);
});

test('visited plus favorite requires both selected states', () => {
  assert.equal(matchesPersonalStatus(favoriteVisited, 'visited', true), true);
  assert.equal(matchesPersonalStatus(visitedOnly, 'visited', true), false);
  assert.equal(matchesPersonalStatus(favoriteNotYet, 'visited', true), false);
});

test('not yet plus favorite requires both selected states', () => {
  assert.equal(matchesPersonalStatus(favoriteNotYet, 'unvisited', true), true);
  assert.equal(matchesPersonalStatus(notYetOnly, 'unvisited', true), false);
  assert.equal(
    matchesPersonalStatus(favoriteVisited, 'unvisited', true),
    false,
  );
});

test('visit filters still work without the favorite filter', () => {
  assert.equal(matchesPersonalStatus(visitedOnly, 'visited', false), true);
  assert.equal(matchesPersonalStatus(notYetOnly, 'visited', false), false);
  assert.equal(matchesPersonalStatus(notYetOnly, 'unvisited', false), true);
  assert.equal(
    matchesPersonalStatus(favoriteVisited, 'unvisited', false),
    false,
  );
});
