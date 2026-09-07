import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  insertVisitSql,
  journalCreatePerformanceBudget,
  upsertVisitedWithRatingSql,
  upsertVisitedWithoutRatingSql,
} from './journal-write.ts';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE visits (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL, item_title TEXT NOT NULL,
      visited_at TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE place_assessments (
      item_id TEXT PRIMARY KEY, overall_rating REAL, is_favorite INTEGER NOT NULL,
      has_visited INTEGER NOT NULL, summary TEXT, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

test('a retried Visit mutation ID stays idempotent', () => {
  const db = database();
  const values = [
    'visit-1',
    'place-1',
    'Place',
    '2026-09-07',
    null,
    't1',
    't1',
  ];
  db.prepare(insertVisitSql).run(...values);
  db.prepare(insertVisitSql).run(...values);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM visits').get().count,
    1,
  );
});

test('Journal upserts preserve unrelated favorite and summary fields', () => {
  const db = database();
  db.prepare(`INSERT INTO place_assessments VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'place-1',
    4,
    1,
    0,
    'keep me',
    't0',
    't0',
  );

  db.prepare(upsertVisitedWithoutRatingSql).run('place-1', 't1', 't1');
  let row = db.prepare('SELECT * FROM place_assessments').get();
  assert.equal(row.overall_rating, 4);
  assert.equal(row.is_favorite, 1);
  assert.equal(row.summary, 'keep me');
  assert.equal(row.has_visited, 1);

  db.prepare(upsertVisitedWithRatingSql).run('place-1', 3.8, 't2', 't2');
  row = db.prepare('SELECT * FROM place_assessments').get();
  assert.equal(row.overall_rating, 3.8);
  assert.equal(row.is_favorite, 1);
  assert.equal(row.summary, 'keep me');
});

test('Journal create keeps the explicit database call budget', () => {
  assert.deepEqual(journalCreatePerformanceBudget, {
    bindingRoundTrips: 2,
    statements: 3,
    fullTableReads: 0,
  });
});
