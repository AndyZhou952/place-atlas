import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type MigrationPackagingStage = 'snapshot-only' | 'reset-stage';

interface ProductionSnapshotMigrationManifest {
  readonly schemaVersion: 1;
  readonly snapshotOnly: {
    readonly activeMigrations: readonly string[];
  };
  readonly pendingReset: {
    readonly path: string;
    readonly sha256: string;
  };
  readonly resetStage: {
    readonly activeMigration: string;
    readonly activeMigrations: readonly string[];
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
  assertExactMembership(
    activeMigrations,
    expectedMigrations,
  );

  const pendingReset = readRequiredFile(root, manifest.pendingReset.path);
  const pendingResetSha256 = sha256(pendingReset);
  if (pendingResetSha256 !== manifest.pendingReset.sha256) {
    throw new Error('Pending reset migration checksum does not match the reviewed value.');
  }

  assertSiteVersionIsDeployable(candidateSiteVersion, manifest.retiredSiteVersions);
  if (stage === 'reset-stage') {
    assertExactActiveReset(root, manifest, pendingReset);
  }

  return {
    activeMigrations,
    pendingResetSha256,
    retiredSiteVersions: manifest.retiredSiteVersions,
  };
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
    readRequiredFile(root, 'scripts/production-snapshot-migration-manifest.json'),
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

function assertExactActiveReset(
  root: string,
  manifest: ProductionSnapshotMigrationManifest,
  pendingReset: Buffer,
): void {
  const activeResetPath = path.join(
    root,
    'drizzle',
    manifest.resetStage.activeMigration,
  );
  let activeReset: Buffer;
  try {
    activeReset = readFileSync(activeResetPath);
  } catch {
    throw new Error('Reset-stage active reset migration is missing.');
  }
  if (!activeReset.equals(pendingReset)) {
    throw new Error('Reset-stage active reset migration does not match pending bytes.');
  }
}

function readRequiredFile(root: string, relativePath: string): Buffer {
  try {
    return readFileSync(path.join(root, relativePath));
  } catch {
    throw new Error('Required migration packaging artifact is missing.');
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseCandidateSiteVersion(argv: readonly string[]): number {
  if (argv.length !== 2 || argv[0] !== '--candidate-site-version') {
    throw new Error('A deploy candidate Site version is required.');
  }
  const candidateSiteVersion = Number(argv[1]);
  if (!Number.isSafeInteger(candidateSiteVersion) || candidateSiteVersion < 0) {
    throw new Error('Deploy candidate Site version must be a non-negative integer.');
  }
  return candidateSiteVersion;
}

const executedFile = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (executedFile) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  verifyMigrationPackaging({
    root,
    stage: 'snapshot-only',
    candidateSiteVersion: parseCandidateSiteVersion(process.argv.slice(2)),
  });
}
