import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const migrationUrl = new URL('./0002_agent_catalog_seed.sql', import.meta.url);
const candidate = {
  id: 'fixture-place', kind: 'food', verificationStatus: 'verified',
  latitude: 35.68, longitude: 139.76,
};

test('legacy catalog schema starts empty and replay preserves existing records', async () => {
  const database = new DatabaseSync(':memory:');
  const migration = await readFile(migrationUrl, 'utf8');
  database.exec(migration);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM agent_catalog_items').get().count, 0);
  database.prepare(`INSERT INTO agent_catalog_items
    (id, kind, verification_status, latitude, longitude, payload_json, record_origin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'catalog_intake', 'created', 'updated')`).run(
    candidate.id, candidate.kind, candidate.verificationStatus, candidate.latitude, candidate.longitude,
    JSON.stringify(candidate),
  );
  database.exec(migration);
  assert.deepEqual(JSON.parse(database.prepare('SELECT payload_json FROM agent_catalog_items').get().payload_json), candidate);
  database.close();
});

test('the PoC Catalog schema rejects indexed facts that diverge from payload', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(migrationUrl, 'utf8'));
  const insert = database.prepare(
    `INSERT INTO agent_catalog_items (
       id, kind, verification_status, latitude, longitude, payload_json,
       record_origin, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'catalog_intake', ?, ?)`,
  );
  const insertedAt = '2026-09-15T02:00:00.000Z';

  for (const mismatch of [
    { verificationStatus: 'needs_review' },
    { kind: 'event' },
    { latitude: candidate.latitude + 0.01 },
    { longitude: candidate.longitude + 0.01 },
  ]) {
    assert.throws(() =>
      insert.run(
        `${candidate.id}-${Object.keys(mismatch)[0]}`,
        mismatch.kind ?? candidate.kind,
        mismatch.verificationStatus ?? candidate.verificationStatus,
        mismatch.latitude ?? candidate.latitude,
        mismatch.longitude ?? candidate.longitude,
        JSON.stringify({
          ...candidate,
          id: `${candidate.id}-${Object.keys(mismatch)[0]}`,
        }),
        insertedAt,
        insertedAt,
      ),
    );
  }
});
