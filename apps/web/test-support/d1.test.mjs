import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { toD1 } from './d1.mjs';

test('offline D1 batches roll back every write when a later statement fails', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE records (id TEXT PRIMARY KEY)');
  const database = toD1(sqlite);
  const insert = database.prepare('INSERT INTO records VALUES (?)');
  const first = insert.bind('first');
  const second = insert.bind('second');
  await assert.rejects(database.batch([first, first]), /UNIQUE/u);
  assert.deepEqual(
    (await database.prepare('SELECT id FROM records').all()).results,
    [],
  );
  await database.batch([first, second]);
  assert.deepEqual(
    (
      await database.prepare('SELECT id FROM records ORDER BY id').all()
    ).results.map((row) => row.id),
    ['first', 'second'],
  );
  assert.equal(
    await database
      .prepare('SELECT id FROM records WHERE id = ?')
      .bind('missing')
      .first(),
    null,
  );
  sqlite.close();
});
