import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { verifiedAtlasItems } from '../../../../apps/web/features/atlas/verified-items.ts';

const expectedSeedDigest =
  'b5edf09c8ea4e963c52c44e866e637c3b0ab50f89fcd2f7ac0097f6c8b3f77cc';
const migrationUrl = new URL('./0002_agent_catalog_seed.sql', import.meta.url);

test('the additive PoC migration copies the complete repo seed without overwriting later edits', async () => {
  const database = new DatabaseSync(':memory:');
  const migration = await readFile(migrationUrl, 'utf8');

  database.exec(migration);

  const rows = database
    .prepare(
      `SELECT id, kind, verification_status, payload_json
       FROM agent_catalog_items
       ORDER BY id ASC`,
    )
    .all();
  const payloads = rows.map((row) => JSON.parse(row.payload_json));
  const seedDigest = createHash('sha256')
    .update(rows.map((row) => row.payload_json).join('\n'))
    .digest('hex');

  assert.equal(rows.length, 5);
  assert.equal(
    rows.filter(
      (row) => row.kind === 'food' && row.verification_status === 'verified',
    ).length,
    3,
  );
  assert.equal(seedDigest, expectedSeedDigest);
  assert.deepEqual(
    payloads,
    verifiedAtlasItems.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    ),
  );

  const edited = { ...payloads[0], title: 'User edited title' };
  database
    .prepare(
      `UPDATE agent_catalog_items
       SET payload_json = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(edited), '2026-09-15T01:00:00.000Z', edited.id);

  database.exec(migration);

  const preserved = database
    .prepare(
      'SELECT payload_json, updated_at FROM agent_catalog_items WHERE id = ?',
    )
    .get(edited.id);
  assert.equal(JSON.parse(preserved.payload_json).title, 'User edited title');
  assert.equal(preserved.updated_at, '2026-09-15T01:00:00.000Z');
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM agent_catalog_items').get()
      .count,
    5,
  );
});

test('the PoC Catalog schema rejects indexed facts that diverge from payload', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(migrationUrl, 'utf8'));
  const candidate = verifiedAtlasItems[0];
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
