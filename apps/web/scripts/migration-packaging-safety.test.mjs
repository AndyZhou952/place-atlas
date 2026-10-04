import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyMigrationPackaging } from './migration-packaging.ts';

test('snapshot packaging rejects a published migration whose bytes no longer match its manifest checksum', () => {
  const root = createFixture({
    migrationSql: 'CREATE TABLE changed (id text);\n',
    reviewedMigrationSql: 'CREATE TABLE reviewed (id text);\n',
  });

  assert.throws(
    () =>
      verifyMigrationPackaging({
        root,
        stage: 'snapshot-only',
        candidateSiteVersion: 17,
      }),
    /active migration checksum does not match/u,
  );
});

test('migration packaging rejects destructive import_jobs SQL in active or pending migrations', () => {
  for (const dangerousSql of [
    'DROP TABLE IF EXISTS "import_jobs";\n',
    'TRUNCATE TABLE [import_jobs];\n',
    'DELETE /* destructive */ FROM `import_jobs`;\n',
    "UPDATE main.import_jobs SET status = 'deleted';\n",
  ]) {
    const root = createFixture({
      migrationSql: 'CREATE TABLE reviewed (id text);\n',
      extraSql: dangerousSql,
    });
    assert.throws(
      () =>
        verifyMigrationPackaging({
          root,
          stage: 'snapshot-only',
          candidateSiteVersion: 17,
        }),
      /unsafe import_jobs mutation/u,
    );
  }
});

function createFixture({
  migrationSql,
  reviewedMigrationSql = migrationSql,
  extraSql,
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-migration-safety-'));
  const drizzle = path.join(root, 'drizzle');
  const pending = path.join(drizzle, 'pending');
  mkdirSync(pending, { recursive: true });
  mkdirSync(path.join(root, 'scripts'));

  const migrationName = '0000_fixture.sql';
  const pendingName = '0001_pending.sql';
  const pendingSql = 'SELECT 1;\n';
  writeFileSync(path.join(drizzle, migrationName), migrationSql);
  writeFileSync(path.join(pending, pendingName), pendingSql);
  if (extraSql) {
    writeFileSync(path.join(pending, '9999_proposed.sql'), extraSql);
  }
  writeFileSync(
    path.join(root, 'scripts/production-snapshot-migration-manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      snapshotOnly: {
        activeMigrations: [migrationName],
        activeMigrationSha256: {
          [migrationName]: sha256(reviewedMigrationSql),
        },
      },
      pendingReset: {
        path: `drizzle/pending/${pendingName}`,
        sha256: sha256(pendingSql),
      },
      resetStage: {
        activeMigration: pendingName,
        activeMigrations: [migrationName, pendingName],
        activeMigrationSha256: {
          [migrationName]: sha256(reviewedMigrationSql),
          [pendingName]: sha256(pendingSql),
        },
      },
      retiredSiteVersions: [16],
    }),
  );
  return root;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
