import assert from 'node:assert/strict';
import test from 'node:test';

import { sortMapItems } from './map-sort.ts';

test('visited scores lead descending; unvisited and unscored places follow by Tabelog', () => {
  const items = [
    { id: 'no-ratings' },
    {
      id: 'unvisited-low',
      hasVisited: false,
      personalRating: 5,
      tabelog: { score: 3.2 },
    },
    {
      id: 'visited-low',
      hasVisited: true,
      personalRating: 3.5,
      tabelog: { score: 3.9 },
    },
    { id: 'visited-unscored', hasVisited: true, tabelog: { score: 3.8 } },
    {
      id: 'visited-high',
      hasVisited: true,
      personalRating: 4,
      tabelog: { score: 3.1 },
    },
    { id: 'unvisited-high', tabelog: { score: 4.2 } },
    { id: 'visited-zero', hasVisited: true, personalRating: 0 },
  ];
  const original = structuredClone(items);
  assert.deepEqual(
    sortMapItems(items).map((item) => item.id),
    [
      'visited-high',
      'visited-low',
      'visited-zero',
      'unvisited-high',
      'visited-unscored',
      'unvisited-low',
      'no-ratings',
    ],
  );
  assert.deepEqual(items, original);
});

test('equal personal scores use Tabelog descending and exact ties preserve input order', () => {
  const items = [
    { id: 'no-tabelog', hasVisited: true, personalRating: 4 },
    {
      id: 'lower',
      hasVisited: true,
      personalRating: 4,
      tabelog: { score: 3.5 },
    },
    {
      id: 'higher',
      hasVisited: true,
      personalRating: 4,
      tabelog: { score: 3.7 },
    },
    {
      id: 'same',
      hasVisited: true,
      personalRating: 4,
      tabelog: { score: 3.7 },
    },
  ];
  assert.deepEqual(
    sortMapItems(items).map((item) => item.id),
    ['higher', 'same', 'lower', 'no-tabelog'],
  );
});

test('nearby distances take priority, with rating order for ties and places without distance', () => {
  const items = [
    { id: 'far', hasVisited: true, personalRating: 5 },
    { id: 'near' },
    { id: 'near-rated', hasVisited: true, personalRating: 3 },
    { id: 'unknown-low', tabelog: { score: 3.2 } },
    { id: 'unknown-high', hasVisited: true, personalRating: 4 },
  ];
  assert.deepEqual(
    sortMapItems(items, { far: 2000, near: 0, 'near-rated': 0 }).map(
      (item) => item.id,
    ),
    ['near-rated', 'near', 'far', 'unknown-high', 'unknown-low'],
  );
});
