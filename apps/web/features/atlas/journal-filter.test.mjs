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
