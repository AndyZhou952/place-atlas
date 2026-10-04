import assert from 'node:assert/strict';
import {
  appendFileSync,
  copyFileSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createCatalogItemProjection } from '../../product/application/catalog/catalog-item-projection.ts';
import {
  captureD1Snapshot,
  captureResetEvidence,
  dryRunAssessmentReset,
  parseResetEvidence,
  readAssessmentResetMigration,
  rehearseAssessmentReset,
  verifyAssessmentReset,
} from './assessment-reset.ts';

const r2Manifest = ['visits/visit-one/media-one', 'unrelated/source-object'];

test('a broad reset is rejected by the full D1 snapshot verifier', () => {
  const { before, after } = evidencePair({
    mutate(database) {
      database.exec('DELETE FROM place_assessments');
    },
  });
  const report = verifyAssessmentReset({ before, after });

  assert.equal(report.ok, false);
  assert.ok(
    report.violations.some((violation) =>
      violation.includes('place_assessments records'),
    ),
  );

  const r2Pair = evidencePair({
    afterManifest: r2Manifest.slice(1),
    mutate(database) {
      database.exec(readAssessmentResetMigration());
    },
  });
  const r2Report = verifyAssessmentReset(r2Pair);
  assert.equal(r2Report.ok, false);
  assert.ok(r2Report.violations.some((violation) => violation.includes('R2')));
});

test('the snapshot includes every relevant sqlite schema object in stable order', () => {
  const database = fixtureDatabase();
  const first = captureD1Snapshot(database);
  const second = captureD1Snapshot(database);

  assert.deepEqual(second, first);
  assert.ok(first.schemaObjects.some((object) => object.type === 'table'));
  assert.ok(first.schemaObjects.some((object) => object.type === 'index'));
  assert.ok(first.schemaObjects.some((object) => object.type === 'trigger'));
  assert.ok(first.schemaObjects.some((object) => object.type === 'view'));
  assert.ok(
    first.schemaObjects.every(
      (object) =>
        object.name &&
        object.tableName &&
        Object.hasOwn(object, 'sql') &&
        typeof object.sql === 'string',
    ),
  );
});

test('the verifier rejects added, dropped, and altered schema objects', () => {
  for (const statement of [
    'CREATE VIEW unexpected_view AS SELECT item_id FROM place_assessments',
    'CREATE INDEX unexpected_index ON place_assessments(summary)',
    'DROP VIEW assessment_titles',
    'DROP TRIGGER preserve_assessment_timestamp',
    'ALTER TABLE place_assessments ADD COLUMN unexpected TEXT',
  ]) {
    const pair = evidencePair({
      mutate(database) {
        database.exec(statement);
      },
    });
    const report = verifyAssessmentReset(pair);

    assert.equal(report.ok, false, statement);
    assert.ok(
      report.violations.some((violation) => violation.includes('schema')),
      statement,
    );
  }
});

test('evidence rejects reused identity, swapped phases, and unpaired D1/R2 captures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-evidence-'));
  const beforeDatabasePath = join(directory, 'before.sqlite');
  const afterDatabasePath = join(directory, 'after.sqlite');
  const beforeManifestPath = join(directory, 'before-r2.json');
  const afterManifestPath = join(directory, 'after-r2.json');
  const alternateDatabasePath = join(directory, 'alternate.sqlite');
  const alternateManifestPath = join(directory, 'alternate-r2.json');
  fixtureDatabase(beforeDatabasePath).close();
  copyFileSync(beforeDatabasePath, afterDatabasePath);
  writeFileSync(beforeManifestPath, JSON.stringify(r2Manifest));
  writeFileSync(afterManifestPath, JSON.stringify(r2Manifest));

  const before = evidence({
    databasePath: beforeDatabasePath,
    manifestPath: beforeManifestPath,
    phase: 'before',
    captureId: 'capture-before',
  });
  const after = evidence({
    databasePath: afterDatabasePath,
    manifestPath: afterManifestPath,
    phase: 'after',
    captureId: 'capture-after',
  });
  assert.equal(verifyAssessmentReset({ before, after }).ok, false);

  const migratedDatabase = new DatabaseSync(afterDatabasePath);
  migratedDatabase.exec(readAssessmentResetMigration());
  migratedDatabase.close();
  const migratedAfter = evidence({
    databasePath: afterDatabasePath,
    manifestPath: afterManifestPath,
    phase: 'after',
    captureId: 'capture-after',
  });
  assert.deepEqual(verifyAssessmentReset({ before, after: migratedAfter }), {
    ok: true,
    violations: [],
  });
  const tampered = structuredClone(migratedAfter);
  tampered.r2.keys.push('injected/object');
  assert.throws(() => parseResetEvidence(tampered), /hash/iu);
  copyFileSync(afterDatabasePath, alternateDatabasePath);
  writeFileSync(alternateManifestPath, JSON.stringify(r2Manifest));
  const alternateAfter = evidence({
    databasePath: alternateDatabasePath,
    manifestPath: alternateManifestPath,
    phase: 'after',
    captureId: 'capture-after',
  });
  assert.equal(
    verifyAssessmentReset({
      before,
      after: { d1: migratedAfter.d1, r2: alternateAfter.r2 },
    }).ok,
    false,
  );

  assert.equal(verifyAssessmentReset({ before, after: before }).ok, false);
  const wrongPhase = evidence({
    databasePath: afterDatabasePath,
    manifestPath: afterManifestPath,
    phase: 'before',
    captureId: 'capture-after-phase',
  });
  assert.equal(verifyAssessmentReset({ before, after: wrongPhase }).ok, false);

  const reusedCapture = evidence({
    databasePath: afterDatabasePath,
    manifestPath: afterManifestPath,
    phase: 'after',
    captureId: 'capture-before',
  });
  assert.equal(
    verifyAssessmentReset({ before, after: reusedCapture }).ok,
    false,
  );

  const other = evidence({
    databasePath: afterDatabasePath,
    manifestPath: afterManifestPath,
    phase: 'after',
    captureId: 'capture-other',
    maintenanceId: 'other-maintenance',
  });
  assert.equal(
    verifyAssessmentReset({
      before,
      after: { d1: migratedAfter.d1, r2: other.r2 },
    }).ok,
    false,
  );

  assert.equal(
    verifyAssessmentReset({
      before,
      after: { d1: migratedAfter.d1, r2: before.r2 },
    }).ok,
    false,
  );
});

test('evidence rejects the same D1 or R2 source file across phases', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-source-'));
  const databasePath = join(directory, 'same.sqlite');
  const otherDatabasePath = join(directory, 'other.sqlite');
  const manifestPath = join(directory, 'same-r2.json');
  const otherManifestPath = join(directory, 'other-r2.json');
  fixtureDatabase(databasePath).close();
  copyFileSync(databasePath, otherDatabasePath);
  writeFileSync(manifestPath, JSON.stringify(r2Manifest));
  writeFileSync(otherManifestPath, JSON.stringify(r2Manifest));
  const before = evidence({
    databasePath,
    manifestPath,
    phase: 'before',
    captureId: 'capture-before-source',
  });
  const sameD1 = evidence({
    databasePath,
    manifestPath: otherManifestPath,
    phase: 'after',
    captureId: 'capture-after-d1-source',
  });
  const sameR2 = evidence({
    databasePath: otherDatabasePath,
    manifestPath,
    phase: 'after',
    captureId: 'capture-after-r2-source',
  });

  assert.equal(verifyAssessmentReset({ before, after: sameD1 }).ok, false);
  assert.equal(verifyAssessmentReset({ before, after: sameR2 }).ok, false);
});

test('capture rejects D1 and R2 sources that currently have hard-link aliases', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-hardlink-'));
  const databasePath = join(directory, 'database.sqlite');
  const databaseAlias = join(directory, 'database-alias.sqlite');
  const manifestPath = join(directory, 'r2.json');
  const manifestAlias = join(directory, 'r2-alias.json');
  fixtureDatabase(databasePath).close();
  writeFileSync(manifestPath, JSON.stringify(r2Manifest));
  linkSync(databasePath, databaseAlias);

  assert.throws(
    () =>
      evidence({
        databasePath,
        manifestPath,
        phase: 'before',
        captureId: 'hardlink-d1',
      }),
    /hard.?link/iu,
  );

  unlinkSync(databaseAlias);
  linkSync(manifestPath, manifestAlias);
  assert.throws(
    () =>
      evidence({
        databasePath,
        manifestPath,
        phase: 'before',
        captureId: 'hardlink-r2',
      }),
    /hard.?link/iu,
  );
});

test('verification rejects D1 evidence captured through distinct hard-link aliases', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-hardlink-d1-'));
  const beforeDatabase = join(directory, 'before.sqlite');
  const afterDatabase = join(directory, 'after.sqlite');
  const beforeManifest = join(directory, 'before-r2.json');
  const afterManifest = join(directory, 'after-r2.json');
  fixtureDatabase(beforeDatabase).close();
  writeFileSync(beforeManifest, JSON.stringify(r2Manifest));
  copyFileSync(beforeManifest, afterManifest);
  const before = evidence({
    databasePath: beforeDatabase,
    manifestPath: beforeManifest,
    phase: 'before',
    captureId: 'hardlink-before-d1',
  });
  linkSync(beforeDatabase, afterDatabase);
  unlinkSync(beforeDatabase);
  const database = new DatabaseSync(afterDatabase);
  database.exec(readAssessmentResetMigration());
  database.close();
  const after = evidence({
    databasePath: afterDatabase,
    manifestPath: afterManifest,
    phase: 'after',
    captureId: 'hardlink-after-d1',
  });

  const report = verifyAssessmentReset({ before, after });
  assert.equal(report.ok, false);
  assert.ok(
    report.violations.some((violation) => violation.includes('source file')),
  );
});

test('verification rejects R2 evidence captured through distinct hard-link aliases', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-hardlink-r2-'));
  const beforeDatabase = join(directory, 'before.sqlite');
  const afterDatabase = join(directory, 'after.sqlite');
  const beforeManifest = join(directory, 'before-r2.json');
  const afterManifest = join(directory, 'after-r2.json');
  fixtureDatabase(beforeDatabase).close();
  copyFileSync(beforeDatabase, afterDatabase);
  writeFileSync(beforeManifest, JSON.stringify(r2Manifest));
  const before = evidence({
    databasePath: beforeDatabase,
    manifestPath: beforeManifest,
    phase: 'before',
    captureId: 'hardlink-before-r2',
  });
  const database = new DatabaseSync(afterDatabase);
  database.exec(readAssessmentResetMigration());
  database.close();
  linkSync(beforeManifest, afterManifest);
  unlinkSync(beforeManifest);
  const after = evidence({
    databasePath: afterDatabase,
    manifestPath: afterManifest,
    phase: 'after',
    captureId: 'hardlink-after-r2',
  });

  const report = verifyAssessmentReset({ before, after });
  assert.equal(report.ok, false);
  assert.ok(
    report.violations.some((violation) => violation.includes('source file')),
  );
});

test('rehearsal rejects hard-linked D1 and R2 before sources', () => {
  for (const aliased of ['d1', 'r2']) {
    const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-rehearse-link-'));
    const beforeDatabase = join(directory, 'before.snapshot.sqlite');
    const databaseAlias = join(directory, 'before-alias.snapshot.sqlite');
    const afterDatabase = join(directory, 'after.snapshot.sqlite');
    const beforeManifest = join(directory, 'before-r2.json');
    const manifestAlias = join(directory, 'before-r2-alias.json');
    const afterManifest = join(directory, 'after-r2.json');
    fixtureDatabase(beforeDatabase).close();
    writeFileSync(beforeManifest, JSON.stringify(r2Manifest));
    linkSync(
      aliased === 'd1' ? beforeDatabase : beforeManifest,
      aliased === 'd1' ? databaseAlias : manifestAlias,
    );

    assert.throws(
      () =>
        rehearseAssessmentReset({
          beforeDatabasePath: beforeDatabase,
          afterDatabasePath: afterDatabase,
          beforeR2ManifestPath: beforeManifest,
          afterR2ManifestPath: afterManifest,
          maintenanceId: `hardlink-rehearsal-${aliased}`,
          beforeCaptureId: `hardlink-before-${aliased}`,
          afterCaptureId: `hardlink-after-${aliased}`,
          capturedAt: '2026-09-12T00:00:00.000Z',
          sourceScope: 'local-hardlink-rehearsal',
        }),
      /hard.?link/iu,
    );
  }
});

test('R2 capture rejects atomic replacement, truncation, append, and link-count changes during one read', () => {
  for (const mutation of ['replace', 'truncate', 'append', 'link']) {
    const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-r2-race-'));
    const databasePath = join(directory, 'database.sqlite');
    const manifestPath = join(directory, 'r2.json');
    const replacementPath = join(directory, 'replacement.json');
    const aliasPath = join(directory, 'r2-alias.json');
    fixtureDatabase(databasePath).close();
    writeFileSync(manifestPath, JSON.stringify(r2Manifest));
    writeFileSync(replacementPath, JSON.stringify(['replacement/object']));

    assert.throws(
      () =>
        captureResetEvidence({
          databasePath,
          r2ManifestPath: manifestPath,
          metadata: captureMetadata('before', `r2-race-${mutation}`),
          hooks: {
            afterR2Preflight() {
              if (mutation === 'replace') {
                renameSync(replacementPath, manifestPath);
              } else if (mutation === 'truncate') {
                truncateSync(manifestPath, 1);
              } else if (mutation === 'append') {
                appendFileSync(manifestPath, ' ');
              } else {
                linkSync(manifestPath, aliasPath);
              }
            },
          },
        }),
      /changed|hard.?link|replaced/iu,
      mutation,
    );
  }
});

test('D1 capture rejects replacement, truncation, append, and link-count changes during its snapshot transaction', () => {
  for (const mutation of ['replace', 'truncate', 'append', 'link']) {
    const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-d1-race-'));
    const databasePath = join(directory, 'database.sqlite');
    const replacementPath = join(directory, 'replacement.sqlite');
    const aliasPath = join(directory, 'database-alias.sqlite');
    const manifestPath = join(directory, 'r2.json');
    fixtureDatabase(databasePath).close();
    fixtureDatabase(replacementPath).close();
    writeFileSync(manifestPath, JSON.stringify(r2Manifest));

    assert.throws(
      () =>
        captureResetEvidence({
          databasePath,
          r2ManifestPath: manifestPath,
          metadata: captureMetadata('before', `d1-race-${mutation}`),
          hooks: {
            afterD1TransactionStarted() {
              if (mutation === 'replace') {
                renameSync(replacementPath, databasePath);
              } else if (mutation === 'truncate') {
                truncateSync(databasePath, 1);
              } else if (mutation === 'append') {
                appendFileSync(databasePath, ' ');
              } else {
                linkSync(databasePath, aliasPath);
              }
            },
          },
        }),
      /changed|hard.?link|replaced/iu,
      mutation,
    );
  }
});

test('stable capture accepts ordinary files, rejects symlinks, and never serializes source paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-path-safety-'));
  const databasePath = join(directory, 'database.sqlite');
  const manifestPath = join(directory, 'r2.json');
  const databaseLink = join(directory, 'database-link.sqlite');
  const manifestLink = join(directory, 'r2-link.json');
  fixtureDatabase(databasePath).close();
  writeFileSync(manifestPath, JSON.stringify(r2Manifest));
  symlinkSync(databasePath, databaseLink);
  symlinkSync(manifestPath, manifestLink);

  const captured = captureResetEvidence({
    databasePath,
    r2ManifestPath: manifestPath,
    metadata: captureMetadata('before', 'ordinary-files'),
  });
  const serialized = JSON.stringify(captured);
  assert.doesNotMatch(serialized, new RegExp(directory, 'u'));
  assert.doesNotMatch(serialized, new RegExp(databasePath, 'u'));
  assert.doesNotMatch(serialized, new RegExp(manifestPath, 'u'));

  assert.throws(
    () =>
      captureResetEvidence({
        databasePath: databaseLink,
        r2ManifestPath: manifestPath,
        metadata: captureMetadata('before', 'database-symlink'),
      }),
    /regular local files|links/iu,
  );
  assert.throws(
    () =>
      captureResetEvidence({
        databasePath,
        r2ManifestPath: manifestLink,
        metadata: captureMetadata('before', 'manifest-symlink'),
      }),
    /regular local files|links/iu,
  );
});

test('the immutable reset changes only four assessment fields and is idempotent', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-whitelist-'));
  const beforePath = join(directory, 'before.sqlite');
  const afterPath = join(directory, 'after.sqlite');
  const beforeManifestPath = join(directory, 'before-r2.json');
  const afterManifestPath = join(directory, 'after-r2.json');
  fixtureDatabase(beforePath).close();
  copyFileSync(beforePath, afterPath);
  writeFileSync(beforeManifestPath, JSON.stringify(r2Manifest));
  writeFileSync(afterManifestPath, JSON.stringify(r2Manifest));
  const before = evidence({
    databasePath: beforePath,
    manifestPath: beforeManifestPath,
    phase: 'before',
    captureId: 'whitelist-before',
  });
  const database = new DatabaseSync(afterPath);
  const migration = readAssessmentResetMigration();

  database.exec(migration);
  const after = evidence({
    databasePath: afterPath,
    manifestPath: afterManifestPath,
    phase: 'after',
    captureId: 'whitelist-after',
  });
  const report = verifyAssessmentReset({ before, after });
  database.exec(migration);
  const repeated = captureD1Snapshot(database);

  assert.deepEqual(report, { ok: true, violations: [] });
  assert.deepEqual(repeated, after.d1.snapshot);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        database
          .prepare(
            `SELECT item_id, overall_rating, is_favorite, has_visited, summary,
                created_at, updated_at
         FROM place_assessments ORDER BY item_id`,
          )
          .all(),
      ),
    ),
    [
      {
        item_id: 'place-one',
        overall_rating: null,
        is_favorite: 0,
        has_visited: 0,
        summary: null,
        created_at: 'assessment-created',
        updated_at: 'assessment-updated',
      },
      {
        item_id: 'place-two',
        overall_rating: null,
        is_favorite: 0,
        has_visited: 0,
        summary: null,
        created_at: 'assessment-two-created',
        updated_at: 'assessment-two-updated',
      },
    ],
  );

  const projection = createCatalogItemProjection([atlasItem()]);
  assert.equal(
    projection.project({
      itemId: 'place-one',
      assessment: {
        itemId: 'place-one',
        isFavorite: false,
        manualVisited: false,
      },
      tombstoned: false,
      visitCount: 1,
    }).hasVisited,
    true,
  );
});

function evidencePair({
  mutate,
  afterManifest = r2Manifest,
  maintenanceId = 'maintenance-pair',
}) {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-pair-'));
  const beforePath = join(directory, 'before.sqlite');
  const afterPath = join(directory, 'after.sqlite');
  const beforeManifestPath = join(directory, 'before-r2.json');
  const afterManifestPath = join(directory, 'after-r2.json');
  fixtureDatabase(beforePath).close();
  copyFileSync(beforePath, afterPath);
  writeFileSync(beforeManifestPath, JSON.stringify(r2Manifest));
  writeFileSync(afterManifestPath, JSON.stringify(afterManifest));
  const before = evidence({
    databasePath: beforePath,
    manifestPath: beforeManifestPath,
    phase: 'before',
    captureId: 'pair-before',
    maintenanceId,
  });
  const database = new DatabaseSync(afterPath);
  try {
    mutate(database);
  } finally {
    database.close();
  }
  const after = evidence({
    databasePath: afterPath,
    manifestPath: afterManifestPath,
    phase: 'after',
    captureId: 'pair-after',
    maintenanceId,
  });
  return { before, after };
}

test('dry-run never mutates and rehearsal is restricted to an explicit local snapshot copy', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-reset-'));
  const safePath = join(directory, 'atlas.snapshot.sqlite');
  const afterPath = join(directory, 'atlas.after.snapshot.sqlite');
  const unsafePath = join(directory, 'atlas.sqlite');
  const r2BeforePath = join(directory, 'r2-before.json');
  const r2AfterPath = join(directory, 'r2-after.json');
  const safeDatabase = fixtureDatabase(safePath);
  const unsafeDatabase = fixtureDatabase(unsafePath);
  safeDatabase.close();
  unsafeDatabase.close();
  writeFileSync(r2BeforePath, JSON.stringify(r2Manifest));

  const beforeDryRun = captureFileSnapshot(unsafePath);
  const dryRun = dryRunAssessmentReset(unsafePath);
  const afterDryRun = captureFileSnapshot(unsafePath);
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.assessmentsToReset, 1);
  assert.deepEqual(afterDryRun, beforeDryRun);

  assert.throws(
    () =>
      rehearseAssessmentReset({
        beforeDatabasePath: unsafePath,
        afterDatabasePath: afterPath,
        beforeR2ManifestPath: r2BeforePath,
        afterR2ManifestPath: r2AfterPath,
        maintenanceId: 'maintenance-rehearsal',
        beforeCaptureId: 'rehearsal-before',
        afterCaptureId: 'rehearsal-after',
        capturedAt: '2026-09-12T00:00:00.000Z',
        sourceScope: 'local-rehearsal',
      }),
    /\.snapshot\.sqlite/u,
  );
  const rehearsal = rehearseAssessmentReset({
    beforeDatabasePath: safePath,
    afterDatabasePath: afterPath,
    beforeR2ManifestPath: r2BeforePath,
    afterR2ManifestPath: r2AfterPath,
    maintenanceId: 'maintenance-rehearsal',
    beforeCaptureId: 'rehearsal-before',
    afterCaptureId: 'rehearsal-after',
    capturedAt: '2026-09-12T00:00:00.000Z',
    sourceScope: 'local-rehearsal',
  });
  assert.equal(rehearsal.mode, 'local-snapshot-rehearsal');
  assert.deepEqual(rehearsal.verification, { ok: true, violations: [] });
  assert.equal(rehearsal.idempotent, true);
});

function evidence({
  databasePath,
  manifestPath,
  phase,
  captureId,
  maintenanceId = 'maintenance-one',
}) {
  return captureResetEvidence({
    databasePath,
    r2ManifestPath: manifestPath,
    metadata: {
      maintenanceId,
      captureId,
      phase,
      sourceScope: 'local-test-export',
      capturedAt: '2026-09-12T00:00:00.000Z',
    },
  });
}

function captureMetadata(phase, captureId) {
  return {
    maintenanceId: 'maintenance-race',
    captureId,
    phase,
    sourceScope: 'local-race-test',
    capturedAt: '2026-09-12T00:00:00.000Z',
  };
}

function fixtureDatabase(path = ':memory:') {
  const database = new DatabaseSync(path);
  for (const migration of [
    '../../drizzle/0000_shallow_doctor_faustus.sql',
    '../../drizzle/0001_dapper_stranger.sql',
    '../../drizzle/0002_funny_wrecker.sql',
  ]) {
    const url = new URL(migration, import.meta.url);
    database.exec(readText(url));
  }
  database.exec(`
    INSERT INTO atlas_items VALUES
      ('place-one', '{"id":"place-one"}', 'needs_review', 'item-created', 'item-updated');
    INSERT INTO atlas_item_overrides VALUES
      ('place-one', 'Edited title', 'Edited description', 'saved', 'override-updated');
    INSERT INTO place_assessments VALUES
      ('place-one', 4.6, 1, 1, 'private summary', 'assessment-created', 'assessment-updated'),
      ('place-two', NULL, 0, 0, NULL, 'assessment-two-created', 'assessment-two-updated');
    INSERT INTO atlas_item_tombstones VALUES
      ('removed-place', 'tombstone-time');
    INSERT INTO visits VALUES
      ('visit-one', 'place-one', 'Place one', '2026-09-11', 'private note', 'visit-created', 'visit-updated');
    INSERT INTO visit_media VALUES
      ('media-one', 'visit-one', 'place-one', 'visits/visit-one/media-one',
       'sushi.jpg', 'image/jpeg', 123, 'sha', 'caption', 0, 'media-created', 'media-updated');
    INSERT INTO import_jobs VALUES
      ('job-one', 'source', 'creator', 'Web', 'queued', 2, 1, 'waiting', 'job-created', 'job-updated');
    INSERT INTO journal_entries VALUES
      ('legacy-one', 'place-one', 'Place one', '2026-09-10', 3.5, 'legacy note', 'legacy-created');
    CREATE VIEW assessment_titles AS
      SELECT item_id, summary FROM place_assessments;
    CREATE TRIGGER preserve_assessment_timestamp
      AFTER UPDATE ON place_assessments
      BEGIN
        SELECT CASE WHEN NEW.created_at <> OLD.created_at
          THEN RAISE(ABORT, 'created_at is immutable') END;
      END;
  `);
  return database;
}

function captureFileSnapshot(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return captureD1Snapshot(database);
  } finally {
    database.close();
  }
}

function readText(url) {
  return readFileSync(url, 'utf8');
}

function atlasItem() {
  return {
    id: 'place-one',
    kind: 'food',
    title: 'Place one',
    area: 'Tokyo',
    address: 'Tokyo address',
    description: 'Description',
    latitude: 35.68,
    longitude: 139.76,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-01',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-01',
    },
    personalState: 'candidate',
    tags: [],
    sources: [],
  };
}
