import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { inspectOwnerPocSeed } from './owner-poc-deployment-preflight.ts';

const repositoryRoot = new URL('../../../', import.meta.url);
const ownerRoot = new URL(
  'features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/',
  repositoryRoot,
);
const manifestUrl = new URL('owner-poc-seed-v1.json', ownerRoot);
const targetDatabaseId = '11111111-2222-4333-8444-555555555555';
const capturedAt = '2026-09-21T12:04:00.000Z';
const now = new Date('2026-09-21T12:05:00.000Z');

void test('owner-poc seed manifest binds version, source, count, IDs, and canonical payload digests', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const database = new DatabaseSync(':memory:');
  for (const name of [
    '0001_owner_poc_schema.sql',
    '0002_owner_poc_catalog_seed.sql',
    '0003_copy_legacy_catalog.sql',
  ]) {
    database.exec(await readFile(new URL(name, ownerRoot), 'utf8'));
  }
  const evidenceSql = await readFile(
    new URL('owner-poc-seed-evidence.sql', import.meta.url),
    'utf8',
  );
  const evidence = seedEvidence(database, evidenceSql);
  const sourceArtifactSha256 = sha256(
    await readFile(new URL(manifest.sourceArtifact, repositoryRoot)),
  );

  assert.deepEqual(
    inspectOwnerPocSeed({
      manifest,
      evidence: seedEvidenceEnvelope(evidence),
      sourceArtifactSha256,
      targetDatabaseId,
      now,
    }),
    { ready: true, blockers: [] },
  );
  for (const drift of [
    evidence.map((row, index) =>
      index === 0 ? { ...row, id: 'drifted-id' } : row,
    ),
    evidence.slice(1),
    evidence.map((row, index) =>
      index === 0 ? { ...row, payload_json: '{"drift":true}' } : row,
    ),
    evidence.map((row, index) =>
      index === 0 ? { ...row, payload_sha256: '0'.repeat(64) } : row,
    ),
  ]) {
    assert.deepEqual(
      inspectOwnerPocSeed({
        manifest,
        evidence: seedEvidenceEnvelope(drift),
        sourceArtifactSha256,
        targetDatabaseId,
        now,
      }),
      { ready: false, blockers: ['seed_manifest_mismatch'] },
    );
  }

  assert.deepEqual(
    inspectOwnerPocSeed({
      manifest,
      evidence: seedEvidenceEnvelope(evidence),
      sourceArtifactSha256: '0'.repeat(64),
      targetDatabaseId,
      now,
    }),
    { ready: false, blockers: ['seed_manifest_mismatch'] },
  );

  for (const untrustedEvidence of [
    seedEvidenceEnvelope(evidence, {
      databaseId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    }),
    seedEvidenceEnvelope(evidence, {
      capturedAt: '2026-09-21T11:59:59.999Z',
    }),
  ]) {
    assert.deepEqual(
      inspectOwnerPocSeed({
        manifest,
        evidence: untrustedEvidence,
        sourceArtifactSha256,
        targetDatabaseId,
        now,
      }),
      { ready: false, blockers: ['seed_manifest_mismatch'] },
    );
  }

  database.exec(`
    UPDATE atlas_items
    SET payload_json = json_set(payload_json, '$.title', 'drifted canonical')
    WHERE id = (
      SELECT item_id
      FROM owner_poc_seed_manifest_records
      ORDER BY item_id
      LIMIT 1
    )
  `);
  const legacyPayload = database
    .prepare(
      `SELECT payload_json
       FROM agent_catalog_items
       WHERE id = (
         SELECT item_id
         FROM owner_poc_seed_manifest_records
         ORDER BY item_id
         LIMIT 1
       )`,
    )
    .get().payload_json;
  assert.doesNotMatch(legacyPayload, /drifted canonical/u);
  assert.deepEqual(
    inspectOwnerPocSeed({
      manifest,
      evidence: seedEvidenceEnvelope(seedEvidence(database, evidenceSql)),
      sourceArtifactSha256,
      targetDatabaseId,
      now,
    }),
    { ready: false, blockers: ['seed_manifest_mismatch'] },
  );
});

function seedEvidenceEnvelope(results, overrides = {}) {
  return {
    databaseId: targetDatabaseId,
    capturedAt,
    results,
    ...overrides,
  };
}

function seedEvidence(database, evidenceSql) {
  return database.prepare(evidenceSql).all();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
