import assert from 'node:assert/strict';
import test from 'node:test';

import { filterJournalVisits } from './journal-filter.ts';

const visits = [
  { id: '1', itemId: 'a', visitedAt: '2026-08-01' },
  { id: '2', itemId: 'a', visitedAt: '2026-09-07' },
  { id: '3', itemId: 'b', visitedAt: '2026-10-01' },
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
