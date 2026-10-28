import assert from 'node:assert/strict';
import test from 'node:test';
import {
  journalEntries,
  mapItems,
  restaurantLinks,
  tableRows,
} from '../src/client/viewmodels/selectors.ts';
import type { Restaurant, Visit } from '../src/shared/types.ts';

const restaurant = (id: string, extra: Partial<Restaurant> = {}): Restaurant => ({
  id,
  title: `店${id}`,
  area: '',
  address: '東京都',
  description: '',
  latitude: 35,
  longitude: 139,
  tags: [],
  cuisines: [],
  reservation: { policy: 'unknown', label: '' },
  addedAt: '2026-10-01',
  updatedAt: '2026-10-01',
  favorite: false,
  visited: false,
  ...extra,
});
const visit = (id: string, restaurantId: string, visitedOn: string): Visit => ({
  id,
  restaurantId,
  visitedOn,
  createdAt: `${visitedOn}T12:00:00.000Z`,
  updatedAt: `${visitedOn}T12:00:00.000Z`,
  media: [],
});

const restaurants = [
  restaurant('1', {
    rating: 7,
    visited: true,
    tabelog: { url: 'https://tabelog.com/a/', score: 3.5 },
  }),
  restaurant('2', {
    tabelog: { url: 'https://tabelog.com/b/', score: 3.9 },
    cuisines: ['japanese.sushi'],
    prefecture: 'JP-13',
  }),
  restaurant('3', { rating: 9, visited: true, favorite: true }),
];
const visits = [
  visit('v1', '1', '2026-10-01'),
  visit('v2', '1', '2026-10-05'),
  visit('v3', '3', '2026-10-03'),
];

test('map score sort ranks visited ratings, then Tabelog; filters combine', () => {
  const ids = (filter: Partial<Parameters<typeof mapItems>[1]>) =>
    mapItems(restaurants, {
      query: '',
      visit: 'all',
      favoritesOnly: false,
      sort: 'added',
      ...filter,
    }).map((r) => r.id);
  assert.deepEqual(ids({ sort: 'score' }), ['3', '1', '2']);
  assert.deepEqual(ids({ visit: 'unvisited' }), ['2']);
  assert.deepEqual(ids({ favoritesOnly: true }), ['3']);
  assert.deepEqual(ids({ query: '店2' }), ['2']);
});

test('table sorts with unknown values last in both directions and filters by code', () => {
  const sorted = (sort: 'lastVisit' | 'rating', ascending: boolean) =>
    tableRows(
      restaurants,
      visits,
      {},
      { query: '', cuisine: 'all', prefecture: 'all', sort, ascending },
    ).map((row) => row.restaurant.id);
  assert.deepEqual(sorted('lastVisit', false), ['1', '3', '2']);
  assert.deepEqual(sorted('lastVisit', true), ['3', '1', '2']);
  assert.deepEqual(sorted('rating', true), ['1', '3', '2']);
  const filtered = tableRows(
    restaurants,
    visits,
    {},
    { query: '', cuisine: 'unknown', prefecture: 'JP-13', sort: 'name', ascending: true },
  );
  assert.deepEqual(filtered, []);
  assert.equal(
    tableRows(
      restaurants,
      visits,
      {},
      { query: '', cuisine: 'all', prefecture: 'all', sort: 'name', ascending: true },
    )[0].lastVisit,
    '2026-10-05',
  );
});

test('journal numbers each restaurant’s visits in date order', () => {
  const entries = journalEntries(visits, restaurants, {
    restaurantId: 'all',
    from: '',
    to: '',
    sort: 'visited-desc',
  });
  assert.deepEqual(
    entries.map((entry) => [entry.visit.id, entry.number, entry.total]),
    [
      ['v2', 2, 2],
      ['v3', 1, 1],
      ['v1', 1, 2],
    ],
  );
  assert.deepEqual(
    journalEntries(visits, restaurants, {
      restaurantId: '1',
      from: '2026-10-02',
      to: '',
      sort: 'visited-asc',
    }).map((e) => e.visit.id),
    ['v2'],
  );
});

test('links are distinct destinations; a Tabelog URL never repeats as booking', () => {
  const links = restaurantLinks(
    restaurant('x', {
      tabelog: { url: 'https://tabelog.com/a/' },
      officialUrl: 'https://shop.example/',
      reservation: { policy: 'reservable', label: '', bookingUrl: 'https://shop.example' },
    }),
  );
  assert.deepEqual(
    links.map((link) => link.label),
    ['Tabelog', 'Official website'],
  );
});
