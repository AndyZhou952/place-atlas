import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyMigrationPackaging } from './migration-packaging.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));

test('snapshot-only packaging has the reviewed maintenance migration set and no reset', () => {
  assert.deepEqual(
    verifyMigrationPackaging({
      root: webRoot,
      stage: 'snapshot-only',
      candidateSiteVersion: 17,
    }),
    {
      activeMigrations: [
        '0000_shallow_doctor_faustus.sql',
        '0001_dapper_stranger.sql',
        '0002_funny_wrecker.sql',
        '0003_maintenance_controls.sql',
      ],
      pendingResetSha256:
        'c79819304252399ae9d4e5c74c46bca33f3c0b259655173749b812e4e4ad8e16',
      retiredSiteVersions: [16],
    },
  );
});

test('reset-stage packaging remains unavailable before its complete reviewed membership exists', () => {
  assert.throws(
    () =>
      verifyMigrationPackaging({
        root: webRoot,
        stage: 'reset-stage',
        candidateSiteVersion: 17,
      }),
    /migration membership is not approved/u,
  );
});
