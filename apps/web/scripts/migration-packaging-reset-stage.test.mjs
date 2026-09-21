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

test('reset-stage packaging accepts the reviewed pending bytes as the sole active 0004', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-reset-stage-'));
  const drizzle = path.join(root, 'drizzle');
  const pending = path.join(drizzle, 'pending');
  mkdirSync(pending, { recursive: true });
  mkdirSync(path.join(root, 'scripts'));

  for (const migration of activeMigrations) {
    writeFileSync(path.join(drizzle, migration), 'SELECT 1;\n');
  }
  const reset = readFileSync(
    path.join(
      webRoot,
      'drizzle/pending/0004_reset_test_place_assessments.sql',
    ),
  );
  writeFileSync(path.join(drizzle, activeMigrations.at(-1)), reset);
  writeFileSync(
    path.join(pending, '0004_reset_test_place_assessments.sql'),
    reset,
  );
  writeFileSync(
    path.join(root, 'scripts/production-snapshot-migration-manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      snapshotOnly: { activeMigrations: activeMigrations.slice(0, -1) },
      pendingReset: {
        path: 'drizzle/pending/0004_reset_test_place_assessments.sql',
        sha256: 'c79819304252399ae9d4e5c74c46bca33f3c0b259655173749b812e4e4ad8e16',
      },
      resetStage: {
        activeMigration: activeMigrations.at(-1),
        activeMigrations,
      },
      retiredSiteVersions: [16],
    }),
  );

  assert.deepEqual(verifyMigrationPackaging({
    root,
    stage: 'reset-stage',
    candidateSiteVersion: 17,
  }).activeMigrations, activeMigrations);
});
