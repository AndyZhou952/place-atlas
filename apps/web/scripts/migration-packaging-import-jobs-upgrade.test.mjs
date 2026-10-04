import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyImportJobsUpgradeSafety } from './migration-packaging.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));

test('packaged snapshot migrations preserve the legacy import_jobs schema, row count, and payload bytes', () => {
  const report = verifyImportJobsUpgradeSafety({
    root: webRoot,
    stage: 'snapshot-only',
    candidateSiteVersion: 17,
  });

  assert.deepEqual(report.appliedUpgradeMigrations, [
    '0001_dapper_stranger.sql',
    '0002_funny_wrecker.sql',
    '0003_maintenance_controls.sql',
  ]);
  assert.equal(report.before.rowCount, 1);
  assert.equal(report.after.rowCount, 1);
  assert.equal(report.after.tableSchemaSha256, report.before.tableSchemaSha256);
  assert.equal(report.after.payloadSha256, report.before.payloadSha256);
});
