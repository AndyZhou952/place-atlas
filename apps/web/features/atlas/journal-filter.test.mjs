import assert from 'node:assert/strict';
import test from 'node:test';

import { filterJournalVisits, sortJournalVisits } from './journal-filter.ts';

const visits = [
  {
    id: '1',
    itemId: 'a',
    visitedAt: '2026-08-01',
    createdAt: '2026-09-12T10:00:00Z',
  },
  {
    id: '2',
    itemId: 'a',
    visitedAt: '2026-09-07',
    createdAt: '2026-09-11T10:00:00Z',
  },
  {
    id: '3',
    itemId: 'b',
    visitedAt: '2026-10-01',
    createdAt: '2026-09-10T10:00:00Z',
  },
];

test('combines place and inclusive date filters', () => {
  assert.deepEqual(
    filterJournalVisits(visits, {
      placeId: 'a',
      fromDate: '2026-08-15',
      toDate: '2026-09-07',
    }).map((visit) => visit.id),
    ['2'],
  );
});

test('supports one-sided date ranges', () => {
  assert.deepEqual(
    filterJournalVisits(visits, {
      placeId: 'all',
      fromDate: '',
      toDate: '2026-09-07',
    }).map((visit) => visit.id),
    ['1', '2'],
  );
});

test('sorts visits globally by visit date or input time across restaurants', () => {
  assert.deepEqual(
    sortJournalVisits(visits, 'visited-desc').map((visit) => visit.id),
    ['3', '2', '1'],
  );
  assert.deepEqual(
    sortJournalVisits(visits, 'visited-asc').map((visit) => visit.id),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    sortJournalVisits(visits, 'recorded-desc').map((visit) => visit.id),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    sortJournalVisits(visits, 'recorded-asc').map((visit) => visit.id),
    ['3', '2', '1'],
  );
  assert.deepEqual(
    visits.map((visit) => visit.id),
    ['1', '2', '3'],
  );
});

test('same-day visits keep their input order as a deterministic tie-breaker', () => {
  const sameDay = [
    {
      id: 'later',
      itemId: 'a',
      visitedAt: '2026-09-10',
      createdAt: '2026-09-12T12:00:00Z',
    },
    {
      id: 'earlier',
      itemId: 'b',
      visitedAt: '2026-09-10',
      createdAt: '2026-09-12T11:00:00Z',
    },
  ];
  assert.deepEqual(
    sortJournalVisits(sameDay, 'visited-asc').map((visit) => visit.id),
    ['earlier', 'later'],
  );
  assert.deepEqual(
    sortJournalVisits(sameDay, 'visited-desc').map((visit) => visit.id),
    ['later', 'earlier'],
  );
});

test('sorts by the displayed overall place score, with repeat visits newest first', () => {
  const itemsById = new Map([
    ['a', { personalRating: 4 }],
    ['b', { personalRating: 3.5 }],
  ]);
  const input = visits.map((visit) => ({ ...visit, privateVisitScore: 5 }));
  assert.deepEqual(
    sortJournalVisits(input, 'score-desc', itemsById).map((visit) => visit.id),
    ['2', '1', '3'],
  );
  assert.deepEqual(
    sortJournalVisits(input, 'score-asc', itemsById).map((visit) => visit.id),
    ['3', '2', '1'],
  );
  assert.deepEqual(
    input.map((visit) => visit.id),
    ['1', '2', '3'],
  );
});

test('score sorting puts unscored and missing places last in both directions, preserving zero', () => {
  const input = [
    ...visits,
    { id: '4', itemId: 'c', visitedAt: '2026-10-02', createdAt: '2026-10-02' },
    {
      id: '5',
      itemId: 'missing',
      visitedAt: '2026-10-03',
      createdAt: '2026-10-03',
    },
  ];
  const itemsById = new Map([
    ['a', { personalRating: 4 }],
    ['b', { personalRating: 0 }],
    ['c', {}],
  ]);
  assert.deepEqual(
    sortJournalVisits(input, 'score-desc', itemsById).map((visit) => visit.id),
    ['2', '1', '3', '5', '4'],
  );
  assert.deepEqual(
    sortJournalVisits(input, 'score-asc', itemsById).map((visit) => visit.id),
    ['3', '2', '1', '5', '4'],
  );
});

test('equal scores across places use visit date, input time, then ID', () => {
  const input = [
    { id: 'c', itemId: 'a', visitedAt: '2026-10-01', createdAt: '2026-10-03' },
    { id: 'b', itemId: 'b', visitedAt: '2026-10-01', createdAt: '2026-10-04' },
    { id: 'a', itemId: 'a', visitedAt: '2026-10-01', createdAt: '2026-10-04' },
  ];
  const itemsById = new Map([
    ['a', { personalRating: 4 }],
    ['b', { personalRating: 4 }],
  ]);
  for (const sort of ['score-desc', 'score-asc']) {
    assert.deepEqual(
      sortJournalVisits(input, sort, itemsById).map((visit) => visit.id),
      ['a', 'b', 'c'],
    );
  }
});
