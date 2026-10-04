import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { planClassificationBackfill } from './catalog-classification-backfill.ts';

const original = {
  id: 'saved',
  kind: 'food',
  address: '東京都港区1-2',
  tags: ['寿司'],
  title: "Owner's saved place",
  description: 'Original summary',
  personalRating: 4.5,
};
const row = { id: original.id, payload_json: JSON.stringify(original) };

test('backfill persists only classification and skips concurrent payload changes', () => {
  const plan = planClassificationBackfill([row]);
  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE atlas_items (id TEXT PRIMARY KEY, payload_json TEXT); CREATE TABLE atlas_catalog_revision (singleton INTEGER, revision_number INTEGER); INSERT INTO atlas_catalog_revision VALUES (1, 0);',
  );
  database
    .prepare('INSERT INTO atlas_items VALUES (?, ?)')
    .run(row.id, row.payload_json);
  database.exec(plan.sql);
  const stored = JSON.parse(
    database.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  const { classification, ...rest } = stored;
  assert.deepEqual(rest, original);
  assert.equal(classification.cuisines[0].categoryId, 'japanese.sushi');
  assert.equal(
    database.prepare('SELECT revision_number FROM atlas_catalog_revision').get()
      .revision_number,
    1,
  );
  database.exec(plan.sql);
  assert.equal(
    database.prepare('SELECT revision_number FROM atlas_catalog_revision').get()
      .revision_number,
    1,
  );
  const changed = { ...original, description: 'Newer owner edit' };
  database
    .prepare('UPDATE atlas_items SET payload_json = ?')
    .run(JSON.stringify(changed));
  database.exec(plan.sql);
  assert.deepEqual(
    JSON.parse(
      database.prepare('SELECT payload_json FROM atlas_items').get()
        .payload_json,
    ),
    changed,
  );
  database.close();
});

test('backfill refuses invalid identifiers, tables, and mismatched item ids', () => {
  assert.throws(
    () => planClassificationBackfill([{ ...row, table_name: 'visits' }]),
    /Unsupported/,
  );
  assert.throws(
    () => planClassificationBackfill([{ ...row, id: 'other' }]),
    /Invalid/,
  );
  assert.equal(
    planClassificationBackfill([
      { ...row, payload_json: JSON.stringify({ ...original, tags: [] }) },
    ]).report.unknownCuisine.length,
    1,
  );
});

test('backfill uses no maintenance table and revision advances only for successful per-item compare-and-swap updates', () => {
  const second = { ...original, id: 'second', description: 'Second original' };
  const plan = planClassificationBackfill([
    row,
    { id: second.id, payload_json: JSON.stringify(second) },
  ]);
  assert.doesNotMatch(plan.sql, /CREATE|TEMP|INSERT|DROP/iu);
  const database = new DatabaseSync(':memory:');
  database.exec(
    'CREATE TABLE atlas_items (id TEXT PRIMARY KEY, payload_json TEXT); CREATE TABLE atlas_catalog_revision (singleton INTEGER, revision_number INTEGER); INSERT INTO atlas_catalog_revision VALUES (1, 10);',
  );
  database
    .prepare('INSERT INTO atlas_items VALUES (?, ?)')
    .run(row.id, row.payload_json);
  database
    .prepare('INSERT INTO atlas_items VALUES (?, ?)')
    .run(
      second.id,
      JSON.stringify({ ...second, description: 'Concurrent edit' }),
    );
  database.exec(plan.sql);
  assert.equal(
    database.prepare('SELECT revision_number FROM atlas_catalog_revision').get()
      .revision_number,
    11,
  );
  assert.equal(
    JSON.parse(
      database
        .prepare('SELECT payload_json FROM atlas_items WHERE id = ?')
        .get(second.id).payload_json,
    ).description,
    'Concurrent edit',
  );
  database.exec(plan.sql);
  assert.equal(
    database.prepare('SELECT revision_number FROM atlas_catalog_revision').get()
      .revision_number,
    11,
  );
  database.close();
});
