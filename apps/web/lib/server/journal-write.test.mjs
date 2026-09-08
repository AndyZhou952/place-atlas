import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  deleteLegacyJournalEntrySql,
  deleteVisitSql,
  insertVisitSql,
  journalCreatePerformanceBudget,
  journalDeletePerformanceBudget,
  journalUpdatePerformanceBudget,
  reconcileVisitedAfterDeleteSql,
  updateVisitSql,
  upsertVisitRatingSql,
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
    CREATE TABLE journal_entries (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL
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

test('Journal update changes the Visit and score without touching preferences', () => {
  const db = database();
  db.prepare(`INSERT INTO visits VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'visit-1',
    'place-1',
    'Place',
    '2026-09-07',
    'old',
    't0',
    't0',
  );
  db.prepare(`INSERT INTO place_assessments VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'place-1',
    3,
    1,
    1,
    'keep me',
    't0',
    't0',
  );

  db.prepare(updateVisitSql).run('2026-09-08', 'new', 't1', 'visit-1');
  db.prepare(upsertVisitRatingSql).run('place-1', 4.2, 1, 1, 't1', 't1');

  const visit = db.prepare('SELECT * FROM visits').get();
  const assessment = db.prepare('SELECT * FROM place_assessments').get();
  assert.equal(visit.visited_at, '2026-09-08');
  assert.equal(visit.note, 'new');
  assert.equal(assessment.overall_rating, 4.2);
  assert.equal(assessment.is_favorite, 1);
  assert.equal(assessment.summary, 'keep me');
});

test('Journal delete reconciles visited state while preserving place memory', () => {
  const db = database();
  for (const id of ['visit-1', 'visit-2']) {
    db.prepare(`INSERT INTO visits VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      'place-1',
      'Place',
      '2026-09-08',
      null,
      't0',
      't0',
    );
  }
  db.prepare(`INSERT INTO place_assessments VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'place-1',
    4.4,
    1,
    1,
    'keep me',
    't0',
    't0',
  );

  for (const id of ['visit-1', 'visit-2']) {
    db.prepare(deleteVisitSql).run(id);
    db.prepare(deleteLegacyJournalEntrySql).run(id);
    db.prepare(reconcileVisitedAfterDeleteSql).run(
      'place-1',
      'place-1',
      't1',
      't1',
    );
    const assessment = db.prepare('SELECT * FROM place_assessments').get();
    assert.equal(assessment.has_visited, id === 'visit-1' ? 1 : 0);
    assert.equal(assessment.overall_rating, 4.4);
    assert.equal(assessment.is_favorite, 1);
    assert.equal(assessment.summary, 'keep me');
  }
});

test('Journal edit and delete keep explicit database call budgets', () => {
  assert.deepEqual(journalUpdatePerformanceBudget, {
    bindingRoundTrips: 2,
    statements: 3,
    fullTableReads: 0,
  });
  assert.deepEqual(journalDeletePerformanceBudget, {
    bindingRoundTrips: 2,
    statements: 5,
    fullTableReads: 0,
  });
});
