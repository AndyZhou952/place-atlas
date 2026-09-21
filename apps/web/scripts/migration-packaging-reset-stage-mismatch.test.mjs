import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyMigrationPackaging } from './migration-packaging.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const activeMigrations = [
  '0000_shallow_doctor_faustus.sql',
  '0001_dapper_stranger.sql',
  '0002_funny_wrecker.sql',
  '0003_maintenance_controls.sql',
  '0004_reset_test_place_assessments.sql',
];

test('reset-stage packaging rejects an active 0004 whose bytes differ from pending', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-reset-mismatch-'));
  const drizzle = path.join(root, 'drizzle');
  const pending = path.join(drizzle, 'pending');
  mkdirSync(pending, { recursive: true });
  mkdirSync(path.join(root, 'scripts'));

  for (const migration of activeMigrations) {
    writeFileSync(path.join(drizzle, migration), 'SELECT 1;\n');
  }
  const pendingReset = readFileSync(
    path.join(webRoot, 'drizzle/pending/0004_reset_test_place_assessments.sql'),
  );
  writeFileSync(path.join(pending, activeMigrations.at(-1)), pendingReset);
  writeFileSync(
    path.join(drizzle, activeMigrations.at(-1)),
    Buffer.concat([pendingReset, Buffer.from('-- altered\n')]),
  );
  writeFileSync(
    path.join(root, 'scripts/production-snapshot-migration-manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      snapshotOnly: { activeMigrations: activeMigrations.slice(0, -1) },
      pendingReset: {
        path: 'drizzle/pending/0004_reset_test_place_assessments.sql',
        sha256:
          'c79819304252399ae9d4e5c74c46bca33f3c0b259655173749b812e4e4ad8e16',
      },
      resetStage: {
        activeMigration: activeMigrations.at(-1),
        activeMigrations,
      },
      retiredSiteVersions: [16],
    }),
  );

  assert.throws(
    () =>
      verifyMigrationPackaging({
        root,
        stage: 'reset-stage',
        candidateSiteVersion: 17,
      }),
    /active reset migration does not match pending bytes/u,
  );
});
