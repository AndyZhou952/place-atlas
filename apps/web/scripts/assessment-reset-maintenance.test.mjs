import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(
  new URL('./assessment-reset-maintenance.ts', import.meta.url),
);

test('the maintenance command defaults to no action', () => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', script],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /No database was changed/u);
  assert.match(result.stderr, /dry-run|rehearse|verify/u);
});

test('the maintenance command rejects every token outside its exact allowlist grammar', () => {
  for (const arguments_ of [
    ['dry-run', '--database-copy', '/tmp/local.sqlite', '--unknown', 'value'],
    [
      'dry-run',
      '--database-copy',
      '/tmp/local.sqlite',
      '--database-copy',
      '/tmp/other.sqlite',
    ],
    ['dry-run', '--database-copy'],
    ['dry-run', '--database-copy', '/tmp/local.sqlite', 'extra'],
    ['dry-run', '--database-copy', '/tmp/local.sqlite', '--remote'],
    ['dry-run', '--database-copy', '/tmp/production.sqlite'],
    ['verify', '--before-evidence', '/tmp/cloudflare-evidence.json'],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', script, ...arguments_],
      { encoding: 'utf8' },
    );

    assert.equal(result.status, 2, arguments_.join(' '));
    assert.match(result.stderr, /rejected|missing|forbidden|usage/iu);
    assert.match(
      result.stderr,
      /No remote or production database was contacted/u,
    );
  }
});

test('strict capture and verify commands produce linked offline evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-cli-'));
  const beforeDatabase = join(directory, 'before.sqlite');
  const afterDatabase = join(directory, 'after.sqlite');
  const beforeManifest = join(directory, 'before-r2.json');
  const afterManifest = join(directory, 'after-r2.json');
  const beforeEvidence = join(directory, 'before-evidence.json');
  const afterEvidence = join(directory, 'after-evidence.json');
  createAssessmentDatabase(beforeDatabase, false);
  createAssessmentDatabase(afterDatabase, true);
  writeFileSync(beforeManifest, JSON.stringify(['object/a']));
  writeFileSync(afterManifest, JSON.stringify(['object/a']));

  for (const capture of [
    {
      phase: 'before',
      captureId: 'capture-cli-before',
      database: beforeDatabase,
      manifest: beforeManifest,
      output: beforeEvidence,
    },
    {
      phase: 'after',
      captureId: 'capture-cli-after',
      database: afterDatabase,
      manifest: afterManifest,
      output: afterEvidence,
    },
  ]) {
    const result = run([
      'capture',
      '--phase',
      capture.phase,
      '--maintenance-id',
      'maintenance-cli',
      '--capture-id',
      capture.captureId,
      '--source-scope',
      'local-cli-test',
      '--captured-at',
      '2026-09-12T00:00:00.000Z',
      '--database-copy',
      capture.database,
      '--r2-manifest',
      capture.manifest,
      '--output',
      capture.output,
    ]);
    assert.equal(result.status, 0, result.stderr);
  }

  const verified = run([
    'verify',
    '--before-evidence',
    beforeEvidence,
    '--after-evidence',
    afterEvidence,
  ]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.deepEqual(JSON.parse(verified.stdout), { ok: true, violations: [] });
});

function run(arguments_) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', script, ...arguments_],
    { encoding: 'utf8' },
  );
}

function createAssessmentDatabase(path, reset) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE place_assessments (
      item_id TEXT PRIMARY KEY NOT NULL,
      overall_rating REAL,
      is_favorite INTEGER NOT NULL,
      has_visited INTEGER NOT NULL,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  database
    .prepare(`INSERT INTO place_assessments VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'place-one',
      reset ? null : 4.5,
      reset ? 0 : 1,
      reset ? 0 : 1,
      reset ? null : 'summary',
      'created',
      'updated',
    );
  database.close();
}
