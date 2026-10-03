import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogTableRows, emptyTableFilters } from './catalog-table-policy.ts';

const items = [
  {
    id: 'a',
    kind: 'food',
    title: 'Ａ Ramen',
    alternateTitle: '甲拉面',
    address: '東京都新宿区',
    area: '新宿',
    personalRating: 0,
    tabelog: { score: 3.5 },
    classification: {
      cuisines: [{ familyId: 'japanese', categoryId: 'japanese.ramen' }],
      geography: { countryCode: 'JP', subdivisionCode: 'JP-13' },
    },
  },
  {
    id: 'b',
    kind: 'food',
    title: 'B Sushi',
    address: '大阪府',
    area: '大阪',
    personalRating: 4.5,
    tabelog: { score: 3.8 },
    googleRating: { score: 4.8 },
    classification: {
      cuisines: [
        { familyId: 'japanese', categoryId: 'japanese.sushi' },
        { familyId: 'japanese', categoryId: 'japanese.izakaya' },
      ],
      geography: { countryCode: 'JP', subdivisionCode: 'JP-27' },
    },
  },
  {
    id: 'c',
    kind: 'food',
    title: 'C Dumplings',
    address: '上海市',
    area: '上海',
    classification: {
      cuisines: [{ familyId: 'chinese', categoryId: 'chinese.dim-sum' }],
      geography: { countryCode: 'CN', subdivisionCode: 'CN-SH' },
    },
  },
  {
    id: 'd',
    kind: 'food',
    title: 'D Candidate',
    address: '',
    area: '',
    verificationStatus: 'needs_review',
  },
  { id: 'e', kind: 'event', title: 'E Festival', address: '', area: '' },
];
const visits = [
  { id: 'old', itemId: 'a', visitedAt: '2026-07-01', createdAt: '2026-10-01' },
  {
    id: 'recent',
    itemId: 'a',
    visitedAt: '2026-09-15',
    createdAt: '2026-09-15',
  },
  {
    id: 'latest',
    itemId: 'b',
    visitedAt: '2026-09-25',
    createdAt: '2026-09-26',
  },
];
function ids(filters = {}, sort = 'name', ascending = true) {
  return catalogTableRows(
    items,
    visits,
    { ...emptyTableFilters, ...filters },
    sort,
    ascending,
  ).map((row) => row.item.id);
}

test('last visit uses actual visit dates across places, keeps unvisited last in either direction', () => {
  assert.deepEqual(ids({}, 'lastVisit', false), ['b', 'a', 'c', 'd', 'e']);
  assert.deepEqual(ids({}, 'lastVisit', true), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(
    catalogTableRows(items, visits, emptyTableFilters, 'lastVisit', false)[1]
      .visits[0].id,
    'recent',
  );
  assert.equal(visits[0].id, 'old');
});

test('score sorting distinguishes zero from unknown and never puts unknown first', () => {
  assert.deepEqual(ids({}, 'personalRating', true), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids({}, 'personalRating', false), ['b', 'a', 'c', 'd', 'e']);
  assert.deepEqual(ids({}, 'tabelog', true), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids({}, 'tabelog', false), ['b', 'a', 'c', 'd', 'e']);
  assert.deepEqual(ids({}, 'google', false), ['b', 'a', 'c', 'd', 'e']);
});

test('specific cuisines filter directly without broad family labels', () => {
  assert.deepEqual(ids({ category: 'japanese.izakaya' }), ['b']);
  assert.deepEqual(ids({ category: 'chinese.dim-sum' }), ['c']);
  assert.deepEqual(ids({ category: 'unknown' }), ['d']);
});

test('country and subdivision constraints combine without losing candidates with unknown geography', () => {
  assert.deepEqual(ids({ country: 'JP', subdivision: 'JP-27' }), ['b']);
  assert.deepEqual(ids({ country: 'CN', subdivision: 'JP-13' }), []);
  assert.deepEqual(ids({ country: 'unknown', kind: 'food' }), ['d']);
  assert.deepEqual(ids({ subdivision: 'unknown' }), ['d', 'e']);
});

test('partial multilingual name and address matching normalizes width and spaces', () => {
  assert.deepEqual(ids({ query: 'a ra' }), ['a']);
  assert.deepEqual(ids({ query: '甲拉' }), ['a']);
  assert.deepEqual(ids({ query: '新宿区' }), ['a']);
  assert.deepEqual(ids({ query: 'not here' }), []);
});

test('equal scores have stable name and id ties and do not mutate source data', () => {
  const input = [
    { ...items[1], id: 'z' },
    { ...items[1], id: 'b' },
  ];
  assert.deepEqual(
    catalogTableRows(input, [], emptyTableFilters, 'personalRating', false).map(
      (row) => row.item.id,
    ),
    ['b', 'z'],
  );
  assert.equal(input[0].id, 'z');
});
