import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

type MigrationPackagingStage = 'snapshot-only' | 'reset-stage';

interface ProductionSnapshotMigrationManifest {
  readonly schemaVersion: 1;
  readonly snapshotOnly: {
    readonly activeMigrations: readonly string[];
    readonly activeMigrationSha256: Readonly<Record<string, string>>;
  };
  readonly pendingReset: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly resetStage: {
    readonly activeMigration: string;
    readonly activeMigrations: readonly string[];
    readonly activeMigrationSha256: Readonly<Record<string, string>>;
  };
  readonly retiredSiteVersions: readonly number[];
}

interface VerifyMigrationPackagingInput {
  readonly root: string;
  readonly stage: MigrationPackagingStage;
  readonly candidateSiteVersion: number;
}

interface MigrationPackagingReport {
  readonly activeMigrations: readonly string[];
  readonly pendingResetSha256: string;
  readonly retiredSiteVersions: readonly number[];
}

interface ImportJobsUpgradeSnapshot {
  readonly tableSchemaSha256: string;
  readonly rowCount: number;
  readonly payloadSha256: string;
}

interface ImportJobsUpgradeSafetyReport {
  readonly appliedUpgradeMigrations: readonly string[];
  readonly before: ImportJobsUpgradeSnapshot;
  readonly after: ImportJobsUpgradeSnapshot;
}

export function verifyMigrationPackaging({
  root,
  stage,
  candidateSiteVersion,
}: VerifyMigrationPackagingInput): MigrationPackagingReport {
  const manifest = readManifest(root);
  const activeMigrations = activeMigrationNames(root);
  const expectedMigrations =
    stage === 'snapshot-only'
      ? manifest.snapshotOnly.activeMigrations
      : manifest.resetStage.activeMigrations;
  const expectedMigrationSha256 =
    stage === 'snapshot-only'
      ? manifest.snapshotOnly.activeMigrationSha256
      : manifest.resetStage.activeMigrationSha256;
  assertExactMembership(activeMigrations, expectedMigrations);
  assertActiveMigrationChecksums(
    root,
    expectedMigrations,
    expectedMigrationSha256,
  );
  assertNoDestructiveImportJobsSql(root);

  const pendingReset = readRequiredBytes(root, manifest.pendingReset.path);
  const pendingResetSha256 = sha256(pendingReset);
  if (pendingResetSha256 !== manifest.pendingReset.sha256) {
    throw new Error(
      'Pending reset migration checksum does not match the reviewed value.',
    );
  }

  assertSiteVersionIsDeployable(
    candidateSiteVersion,
    manifest.retiredSiteVersions,
  );
  if (stage === 'reset-stage') {
    assertExactActiveReset(root, manifest, pendingReset);
  }

  return {
    activeMigrations,
    pendingResetSha256,
    retiredSiteVersions: manifest.retiredSiteVersions,
  };
}

export function verifyImportJobsUpgradeSafety(
  input: VerifyMigrationPackagingInput,
): ImportJobsUpgradeSafetyReport {
  const packaging = verifyMigrationPackaging(input);
  const [baselineMigration, ...upgradeMigrations] = packaging.activeMigrations;
  if (!baselineMigration) {
    throw new Error('At least one active migration is required.');
  }

  const database = new DatabaseSync(':memory:');
  try {
    database.exec(readRequiredText(input.root, `drizzle/${baselineMigration}`));
    insertImportJobsSentinel(database);
    const before = captureImportJobsSnapshot(database);
    for (const migration of upgradeMigrations) {
      database.exec(readRequiredText(input.root, `drizzle/${migration}`));
    }
    const after = captureImportJobsSnapshot(database);
    assertImportJobsSnapshotUnchanged(before, after);
    return {
      appliedUpgradeMigrations: upgradeMigrations,
      before,
      after,
    };
  } finally {
    database.close();
  }
}

export function assertSiteVersionIsDeployable(
  siteVersion: number,
  retiredSiteVersions: readonly number[],
): void {
  if (retiredSiteVersions.includes(siteVersion)) {
    throw new Error(`Site version ${siteVersion} is permanently retired.`);
  }
}

function readManifest(root: string): ProductionSnapshotMigrationManifest {
  const manifest = JSON.parse(
    readRequiredText(
      root,
      'scripts/production-snapshot-migration-manifest.json',
    ),
  ) as ProductionSnapshotMigrationManifest;
  if (manifest.schemaVersion !== 1) {
    throw new Error('Migration manifest schema version is not supported.');
  }
  return manifest;
}

function activeMigrationNames(root: string): readonly string[] {
  return readdirSync(path.join(root, 'drizzle'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

function assertExactMembership(
  actual: readonly string[],
  expected: readonly string[],
): void {
  if (
    actual.length !== expected.length ||
    actual.some((migration, index) => migration !== expected[index])
  ) {
    throw new Error('Snapshot-only migration membership is not approved.');
  }
}

function assertActiveMigrationChecksums(
  root: string,
  activeMigrations: readonly string[],
  expectedSha256: Readonly<Record<string, string>>,
): void {
  assertExactMembership(Object.keys(expectedSha256).sort(), activeMigrations);
  for (const migration of activeMigrations) {
    const actual = sha256(readRequiredBytes(root, `drizzle/${migration}`));
    if (actual !== expectedSha256[migration]) {
      throw new Error('Published active migration checksum does not match.');
    }
  }
}

function assertNoDestructiveImportJobsSql(root: string): void {
  for (const migrationPath of sqlFilesRecursively(path.join(root, 'drizzle'))) {
    const sql = stripSqlCommentsAndLiterals(
      readFileSync(migrationPath, 'utf8'),
    );
    const importJobs = String.raw`(?:main\s*\.\s*)?(?:import_jobs|"import_jobs"|\x60import_jobs\x60|\[import_jobs\])`;
    const destructiveStatements = [
      new RegExp(
        String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?${importJobs}`,
        'iu',
      ),
      new RegExp(String.raw`\btruncate\s+(?:table\s+)?${importJobs}`, 'iu'),
      new RegExp(String.raw`\bdelete\s+from\s+${importJobs}`, 'iu'),
      new RegExp(String.raw`\bupdate\s+${importJobs}\s+set\b`, 'iu'),
    ];
    if (destructiveStatements.some((pattern) => pattern.test(sql))) {
      throw new Error('unsafe import_jobs mutation in migration SQL.');
    }
  }
}

function sqlFilesRecursively(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sqlFilesRecursively(entryPath);
    return entry.isFile() && entry.name.endsWith('.sql') ? [entryPath] : [];
  });
}

function stripSqlCommentsAndLiterals(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/--[^\r\n]*/gu, ' ')
    .replace(/'(?:''|[^'])*'/gu, "''");
}

function insertImportJobsSentinel(database: DatabaseSync): void {
  database
    .prepare(`INSERT INTO import_jobs (
      id, source_ref, creator_name, platform, status, discovered_count,
      needs_review_count, message, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'sentinel-import-job',
      'https://example.invalid/店?query=coffee&note=%00',
      'Sentinel 店主',
      'legacy\ncreator-import',
      'needs_review',
      17,
      3,
      "Keep these bytes: 日本語, emoji 🗺️, quote ' and newline\nend.",
      '2026-09-24T00:00:00.000Z',
      '2026-09-24T00:00:01.000Z',
    );
}

function captureImportJobsSnapshot(
  database: DatabaseSync,
): ImportJobsUpgradeSnapshot {
  const tableSchema = database
    .prepare(
      `SELECT type, name, sql
       FROM sqlite_master
       WHERE tbl_name = 'import_jobs' AND type IN ('table', 'index')
       ORDER BY type, name`,
    )
    .all();
  const countRow = database
    .prepare('SELECT COUNT(*) AS row_count FROM import_jobs')
    .get() as { readonly row_count: number };
  const payloadRows = database
    .prepare(`SELECT
      typeof(id) AS id_type, hex(CAST(id AS BLOB)) AS id_bytes,
      typeof(source_ref) AS source_ref_type,
      hex(CAST(source_ref AS BLOB)) AS source_ref_bytes,
      typeof(creator_name) AS creator_name_type,
      hex(CAST(creator_name AS BLOB)) AS creator_name_bytes,
      typeof(platform) AS platform_type,
      hex(CAST(platform AS BLOB)) AS platform_bytes,
      typeof(status) AS status_type,
      hex(CAST(status AS BLOB)) AS status_bytes,
      typeof(discovered_count) AS discovered_count_type,
      hex(CAST(discovered_count AS BLOB)) AS discovered_count_bytes,
      typeof(needs_review_count) AS needs_review_count_type,
      hex(CAST(needs_review_count AS BLOB)) AS needs_review_count_bytes,
      typeof(message) AS message_type,
      hex(CAST(message AS BLOB)) AS message_bytes,
      typeof(created_at) AS created_at_type,
      hex(CAST(created_at AS BLOB)) AS created_at_bytes,
      typeof(updated_at) AS updated_at_type,
      hex(CAST(updated_at AS BLOB)) AS updated_at_bytes
    FROM import_jobs ORDER BY id`)
    .all();
  return {
    tableSchemaSha256: sha256(Buffer.from(JSON.stringify(tableSchema))),
    rowCount: Number(countRow.row_count),
    payloadSha256: sha256(Buffer.from(JSON.stringify(payloadRows))),
  };
}

function assertImportJobsSnapshotUnchanged(
  before: ImportJobsUpgradeSnapshot,
  after: ImportJobsUpgradeSnapshot,
): void {
  if (after.tableSchemaSha256 !== before.tableSchemaSha256) {
    throw new Error('import_jobs table schema changed during upgrade.');
  }
  if (after.rowCount !== before.rowCount) {
    throw new Error('import_jobs row count changed during upgrade.');
  }
  if (after.payloadSha256 !== before.payloadSha256) {
    throw new Error('import_jobs payload bytes changed during upgrade.');
  }
}

function assertExactActiveReset(
  root: string,
  manifest: ProductionSnapshotMigrationManifest,
  pendingReset: Uint8Array,
): void {
  const activeResetPath = path.join(
    root,
    'drizzle',
    manifest.resetStage.activeMigration,
  );
  let activeReset: Uint8Array;
  try {
    activeReset = readFileSync(activeResetPath);
  } catch {
    throw new Error('Reset-stage active reset migration is missing.');
  }
  if (!bytesEqual(activeReset, pendingReset)) {
    throw new Error(
      'Reset-stage active reset migration does not match pending bytes.',
    );
  }
}

function readRequiredBytes(root: string, relativePath: string): Uint8Array {
  try {
    return readFileSync(path.join(root, relativePath));
  } catch {
    throw new Error('Required migration packaging artifact is missing.');
  }
}

function readRequiredText(root: string, relativePath: string): string {
  try {
    return readFileSync(path.join(root, relativePath), 'utf8');
  } catch {
    throw new Error('Required migration packaging artifact is missing.');
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index])
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseCandidateSiteVersion(argv: readonly string[]): number {
  if (argv.length !== 2 || argv[0] !== '--candidate-site-version') {
    throw new Error('A deploy candidate Site version is required.');
  }
  const candidateSiteVersion = Number(argv[1]);
  if (!Number.isSafeInteger(candidateSiteVersion) || candidateSiteVersion < 0) {
    throw new Error(
      'Deploy candidate Site version must be a non-negative integer.',
    );
  }
  return candidateSiteVersion;
}

const executedFile = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (executedFile) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  verifyImportJobsUpgradeSafety({
    root,
    stage: 'snapshot-only',
    candidateSiteVersion: parseCandidateSiteVersion(process.argv.slice(2)),
  });
}
