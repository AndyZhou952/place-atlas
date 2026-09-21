import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  statSync,
  type BigIntStats,
} from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type SnapshotScalar = string | number | null;
type SnapshotRow = Readonly<Record<string, SnapshotScalar>>;

export interface D1TableSnapshot {
  readonly schemaSql: string;
  readonly columns: readonly string[];
  readonly rows: readonly SnapshotRow[];
}

export interface D1SchemaObjectSnapshot {
  readonly type: 'index' | 'table' | 'trigger' | 'view';
  readonly name: string;
  readonly tableName: string;
  readonly sql: string;
}

export interface D1Snapshot {
  readonly schemaObjects: readonly D1SchemaObjectSnapshot[];
  readonly tables: Readonly<Record<string, D1TableSnapshot>>;
}

export type ResetEvidencePhase = 'before' | 'after';

export interface ResetCaptureMetadataInput {
  readonly maintenanceId: string;
  readonly captureId: string;
  readonly phase: ResetEvidencePhase;
  readonly sourceScope: string;
  readonly capturedAt: string;
}

export interface ResetEvidenceMetadata extends ResetCaptureMetadataInput {
  readonly version: 2;
  readonly sourceIdentity: LocalFileIdentity;
  readonly pairingHash: string;
  readonly contentHash: string;
  readonly evidenceHash: string;
}

export interface LocalFileIdentity {
  readonly device: string;
  readonly inode: string;
  readonly pathHash: string;
  readonly size: string;
  readonly ctimeNs: string;
}

export interface D1ResetEvidence {
  readonly kind: 'd1';
  readonly metadata: ResetEvidenceMetadata;
  readonly snapshot: D1Snapshot;
}

export interface R2ResetEvidence {
  readonly kind: 'r2';
  readonly metadata: ResetEvidenceMetadata;
  readonly keys: readonly string[];
}

export interface ResetEvidenceBundle {
  readonly d1: D1ResetEvidence;
  readonly r2: R2ResetEvidence;
}

export interface ResetVerification {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

export interface DryRunResult {
  readonly mode: 'dry-run';
  readonly assessmentsToReset: number;
  readonly snapshot: D1Snapshot;
}

export interface RehearsalResult {
  readonly mode: 'local-snapshot-rehearsal';
  readonly verification: ResetVerification;
  readonly idempotent: boolean;
  readonly before: ResetEvidenceBundle;
  readonly after: ResetEvidenceBundle;
}

interface EvidenceCaptureHooks {
  readonly afterD1TransactionStarted?: () => void;
  readonly afterR2Preflight?: () => void;
}

const resettableAssessmentColumns = new Map<string, SnapshotScalar>([
  ['overall_rating', null],
  ['is_favorite', 0],
  ['has_visited', 0],
  ['summary', null],
]);

const assessmentResetMigrationUrl = new URL(
  '../../drizzle/pending/0004_reset_test_place_assessments.sql',
  import.meta.url,
);

export function readAssessmentResetMigration(): string {
  return readFileSync(assessmentResetMigrationUrl, 'utf8');
}

export function captureD1Snapshot(database: DatabaseSync): D1Snapshot {
  const schemaObjects = (
    database
      .prepare(
        `SELECT type, name, tbl_name AS tableName, sql
         FROM sqlite_schema
         WHERE type IN ('table', 'index', 'trigger', 'view')
           AND NOT (type = 'table' AND name LIKE 'sqlite_%')
         ORDER BY type, name, tbl_name, sql`,
      )
      .all() as unknown as readonly {
      readonly type: D1SchemaObjectSnapshot['type'];
      readonly name: string;
      readonly tableName: string;
      readonly sql: string | null;
    }[]
  ).map((object) => ({
    type: object.type,
    name: object.name,
    tableName: object.tableName,
    sql: object.sql?.trim() ?? '',
  }));
  const tables: Record<string, D1TableSnapshot> = {};

  for (const table of schemaObjects.filter(
    (object) => object.type === 'table',
  )) {
    const identifier = quoteIdentifier(table.name);
    const columns = (
      database
        .prepare(`PRAGMA table_info(${identifier})`)
        .all() as unknown as readonly { readonly name: string }[]
    ).map((column) => column.name);
    const rows = normalizeRows(
      database.prepare(`SELECT * FROM ${identifier}`).all(),
    );
    tables[table.name] = { schemaSql: table.sql, columns, rows };
  }

  return { schemaObjects, tables };
}

export function captureResetEvidence(input: {
  readonly databasePath: string;
  readonly r2ManifestPath: string;
  readonly metadata: ResetCaptureMetadataInput;
  readonly hooks?: EvidenceCaptureHooks;
}): ResetEvidenceBundle {
  assertCaptureMetadata(input.metadata);
  const databaseCapture = readStableD1(
    input.databasePath,
    captureD1Snapshot,
    input.hooks?.afterD1TransactionStarted,
  );
  const manifestCapture = readStableTextFile(
    input.r2ManifestPath,
    input.hooks?.afterR2Preflight,
  );
  const snapshot = databaseCapture.value;
  const keys = parseR2Manifest(manifestCapture.value);
  const pairingHash = sha256({
    metadata: input.metadata,
    d1SourceIdentity: databaseCapture.identity,
    d1ContentHash: sha256(snapshot),
    r2SourceIdentity: manifestCapture.identity,
    r2ContentHash: sha256(keys),
  });
  return {
    d1: createD1Evidence(
      snapshot,
      input.metadata,
      databaseCapture.identity,
      pairingHash,
    ),
    r2: createR2Evidence(
      keys,
      input.metadata,
      manifestCapture.identity,
      pairingHash,
    ),
  };
}

export function parseResetEvidence(value: unknown): ResetEvidenceBundle {
  if (!isRecord(value) || !isRecord(value.d1) || !isRecord(value.r2)) {
    throw new TypeError('Reset evidence must contain D1 and R2 artifacts.');
  }
  const evidence = value as unknown as ResetEvidenceBundle;
  const violations = validateEvidenceBundle(evidence);
  if (violations.length > 0) {
    throw new TypeError(`Invalid reset evidence: ${violations.join(' ')}`);
  }
  return evidence;
}

export function readResetEvidence(path: string): ResetEvidenceBundle {
  return parseResetEvidence(JSON.parse(readStableTextFile(path).value));
}

export function verifyAssessmentReset(input: {
  readonly before: ResetEvidenceBundle;
  readonly after: ResetEvidenceBundle;
}): ResetVerification {
  const violations = [
    ...validateEvidenceBundle(input.before),
    ...validateEvidenceBundle(input.after),
  ];
  verifyEvidenceRelationship(input.before, input.after, violations);
  violations.push(
    ...verifySnapshotChanges({
      before: input.before.d1.snapshot,
      after: input.after.d1.snapshot,
      r2Before: input.before.r2.keys,
      r2After: input.after.r2.keys,
    }).violations,
  );
  return { ok: violations.length === 0, violations };
}

export function dryRunAssessmentReset(databaseCopyPath: string): DryRunResult {
  return readStableD1<DryRunResult>(databaseCopyPath, (database) => {
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM place_assessments
         WHERE overall_rating IS NOT NULL
            OR is_favorite <> 0
            OR has_visited <> 0
            OR summary IS NOT NULL`,
      )
      .get() as unknown as { readonly count: number };
    return {
      mode: 'dry-run',
      assessmentsToReset: row.count,
      snapshot: captureD1Snapshot(database),
    };
  }).value;
}

export function rehearseAssessmentReset(input: {
  readonly beforeDatabasePath: string;
  readonly afterDatabasePath: string;
  readonly beforeR2ManifestPath: string;
  readonly afterR2ManifestPath: string;
  readonly maintenanceId: string;
  readonly beforeCaptureId: string;
  readonly afterCaptureId: string;
  readonly sourceScope: string;
  readonly capturedAt: string;
}): RehearsalResult {
  const beforeDatabasePath = assertLocalSnapshotCopy(input.beforeDatabasePath);
  const beforeR2ManifestPath = assertLocalRegularFile(
    input.beforeR2ManifestPath,
  );
  const afterDatabasePath = assertNewLocalSnapshotCopy(input.afterDatabasePath);
  const afterR2ManifestPath = assertNewLocalFile(input.afterR2ManifestPath);
  if (
    resolve(beforeDatabasePath) === resolve(afterDatabasePath) ||
    resolve(beforeR2ManifestPath) === resolve(afterR2ManifestPath)
  ) {
    throw new Error(
      'Before and after evidence sources must be distinct files.',
    );
  }
  copyStableLocalFile(
    beforeDatabasePath,
    afterDatabasePath,
    constants.COPYFILE_EXCL,
  );
  copyStableLocalFile(
    beforeR2ManifestPath,
    afterR2ManifestPath,
    constants.COPYFILE_EXCL,
  );
  const before = captureResetEvidence({
    databasePath: beforeDatabasePath,
    r2ManifestPath: beforeR2ManifestPath,
    metadata: evidenceInput(input, 'before'),
  });
  const database = new DatabaseSync(afterDatabasePath);
  try {
    const migration = readAssessmentResetMigration();
    database.exec('BEGIN IMMEDIATE');
    database.exec(migration);
    database.exec('COMMIT');
    const after = captureResetEvidence({
      databasePath: afterDatabasePath,
      r2ManifestPath: afterR2ManifestPath,
      metadata: evidenceInput(input, 'after'),
    });
    const verification = verifyAssessmentReset({ before, after });
    database.exec('BEGIN IMMEDIATE');
    database.exec(migration);
    database.exec('COMMIT');
    const idempotent = sameJson(after.d1.snapshot, captureD1Snapshot(database));
    if (!verification.ok || !idempotent) {
      throw new Error(
        `Local snapshot rehearsal failed: ${[
          ...verification.violations,
          ...(idempotent ? [] : ['Migration is not idempotent.']),
        ].join(' ')}`,
      );
    }
    return {
      mode: 'local-snapshot-rehearsal',
      verification,
      idempotent,
      before,
      after,
    };
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // No transaction remains when a commit or begin did not complete.
    }
    throw error;
  } finally {
    database.close();
  }
}

function verifySnapshotChanges(input: {
  readonly before: D1Snapshot;
  readonly after: D1Snapshot;
  readonly r2Before: readonly string[];
  readonly r2After: readonly string[];
}): ResetVerification {
  const violations: string[] = [];
  if (!sameJson(input.before.schemaObjects, input.after.schemaObjects)) {
    violations.push('D1 schema objects changed.');
  }
  const beforeNames = Object.keys(input.before.tables).sort();
  const afterNames = Object.keys(input.after.tables).sort();
  if (!sameJson(beforeNames, afterNames)) {
    violations.push('D1 table set changed.');
  }
  for (const name of new Set([...beforeNames, ...afterNames])) {
    const before = input.before.tables[name];
    const after = input.after.tables[name];
    if (!before || !after) continue;
    if (
      before.schemaSql !== after.schemaSql ||
      !sameJson(before.columns, after.columns)
    ) {
      violations.push(`${name} schema changed.`);
      continue;
    }
    if (name === 'place_assessments') {
      verifyAssessmentRows(before.rows, after.rows, violations);
    } else if (!sameJson(before.rows, after.rows)) {
      violations.push(`${name} records changed.`);
    }
  }
  if (
    !sameJson(
      normalizeManifest(input.r2Before),
      normalizeManifest(input.r2After),
    )
  ) {
    violations.push('R2 object-key manifest changed.');
  }
  return { ok: violations.length === 0, violations };
}

function verifyAssessmentRows(
  beforeRows: readonly SnapshotRow[],
  afterRows: readonly SnapshotRow[],
  violations: string[],
): void {
  const beforeById = rowsByItemId(beforeRows);
  const afterById = rowsByItemId(afterRows);
  if (
    beforeRows.length !== afterRows.length ||
    !sameJson([...beforeById.keys()].sort(), [...afterById.keys()].sort())
  ) {
    violations.push('place_assessments records changed.');
    return;
  }
  for (const [itemId, before] of beforeById) {
    const after = afterById.get(itemId);
    if (!after) continue;
    for (const [column, beforeValue] of Object.entries(before)) {
      const allowedTarget = resettableAssessmentColumns.get(column);
      if (resettableAssessmentColumns.has(column)) {
        if (after[column] !== allowedTarget) {
          violations.push(
            `place_assessments.${column} did not reach its reset value for ${itemId}.`,
          );
        }
      } else if (after[column] !== beforeValue) {
        violations.push(
          `place_assessments.${column} changed outside the whitelist for ${itemId}.`,
        );
      }
    }
  }
}

function rowsByItemId(
  rows: readonly SnapshotRow[],
): ReadonlyMap<string, SnapshotRow> {
  return new Map(
    rows.flatMap((row) =>
      typeof row.item_id === 'string' ? [[row.item_id, row]] : [],
    ),
  );
}

function normalizeRows(rows: readonly object[]): readonly SnapshotRow[] {
  return rows
    .map((row) => JSON.parse(JSON.stringify(row)) as SnapshotRow)
    .sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right)),
    );
}

function normalizeManifest(keys: readonly string[]): readonly string[] {
  return [...new Set(keys)].sort();
}

function createD1Evidence(
  snapshot: D1Snapshot,
  input: ResetCaptureMetadataInput,
  sourceIdentity: LocalFileIdentity,
  pairingHash: string,
): D1ResetEvidence {
  return {
    kind: 'd1',
    metadata: createEvidenceMetadata(
      'd1',
      snapshot,
      input,
      sourceIdentity,
      pairingHash,
    ),
    snapshot,
  };
}

function createR2Evidence(
  keys: readonly string[],
  input: ResetCaptureMetadataInput,
  sourceIdentity: LocalFileIdentity,
  pairingHash: string,
): R2ResetEvidence {
  const normalized = normalizeManifest(keys);
  return {
    kind: 'r2',
    metadata: createEvidenceMetadata(
      'r2',
      normalized,
      input,
      sourceIdentity,
      pairingHash,
    ),
    keys: normalized,
  };
}

function createEvidenceMetadata(
  kind: 'd1' | 'r2',
  content: unknown,
  input: ResetCaptureMetadataInput,
  sourceIdentity: LocalFileIdentity,
  pairingHash: string,
): ResetEvidenceMetadata {
  const contentHash = sha256(content);
  const unsigned = {
    version: 2 as const,
    ...input,
    sourceIdentity,
    pairingHash,
    contentHash,
  };
  return {
    ...unsigned,
    evidenceHash: sha256({ kind, metadata: unsigned }),
  };
}

function validateEvidenceBundle(bundle: ResetEvidenceBundle): string[] {
  const violations: string[] = [];
  if (
    !bundle.d1 ||
    bundle.d1.kind !== 'd1' ||
    !bundle.d1.snapshot ||
    !bundle.r2 ||
    bundle.r2.kind !== 'r2' ||
    !Array.isArray(bundle.r2.keys)
  ) {
    return ['Reset evidence structure is invalid.'];
  }
  validateArtifact(bundle.d1, bundle.d1.snapshot, violations);
  validateArtifact(bundle.r2, normalizeManifest(bundle.r2.keys), violations);
  for (const key of [
    'maintenanceId',
    'captureId',
    'phase',
    'sourceScope',
    'capturedAt',
    'pairingHash',
  ] as const) {
    if (bundle.d1.metadata?.[key] !== bundle.r2.metadata?.[key]) {
      violations.push(`D1/R2 evidence is not paired by ${key}.`);
    }
  }
  return violations;
}

function validateArtifact(
  artifact: D1ResetEvidence | R2ResetEvidence,
  content: unknown,
  violations: string[],
): void {
  const metadata = artifact.metadata;
  if (!metadata || metadata.version !== 2) {
    violations.push(`${artifact.kind} evidence version is invalid.`);
    return;
  }
  try {
    assertCaptureMetadata(metadata);
  } catch {
    violations.push(`${artifact.kind} evidence metadata is invalid.`);
  }
  if (!isLocalFileIdentity(metadata.sourceIdentity)) {
    violations.push(`${artifact.kind} source file identity is invalid.`);
  }
  if (metadata.contentHash !== sha256(content)) {
    violations.push(`${artifact.kind} evidence content hash is invalid.`);
  }
  const { evidenceHash, ...unsigned } = metadata;
  if (evidenceHash !== sha256({ kind: artifact.kind, metadata: unsigned })) {
    violations.push(`${artifact.kind} evidence hash is invalid.`);
  }
}

function verifyEvidenceRelationship(
  before: ResetEvidenceBundle,
  after: ResetEvidenceBundle,
  violations: string[],
): void {
  if (before.d1.metadata?.phase !== 'before') {
    violations.push('Before evidence has the wrong phase.');
  }
  if (after.d1.metadata?.phase !== 'after') {
    violations.push('After evidence has the wrong phase.');
  }
  if (
    before.d1.metadata?.maintenanceId !== after.d1.metadata?.maintenanceId ||
    before.d1.metadata?.sourceScope !== after.d1.metadata?.sourceScope
  ) {
    violations.push(
      'Before and after evidence belong to different maintenance runs.',
    );
  }
  if (before.d1.metadata?.captureId === after.d1.metadata?.captureId) {
    violations.push(
      'Before and after evidence reuse the same capture identity.',
    );
  }
  if (
    samePhysicalFile(
      before.d1.metadata?.sourceIdentity,
      after.d1.metadata?.sourceIdentity,
    ) ||
    samePhysicalFile(
      before.r2.metadata?.sourceIdentity,
      after.r2.metadata?.sourceIdentity,
    )
  ) {
    violations.push('Before and after evidence reuse a source file.');
  }
}

function evidenceInput(
  input: Parameters<typeof rehearseAssessmentReset>[0],
  phase: ResetEvidencePhase,
): ResetCaptureMetadataInput {
  return {
    maintenanceId: input.maintenanceId,
    captureId:
      phase === 'before' ? input.beforeCaptureId : input.afterCaptureId,
    phase,
    sourceScope: input.sourceScope,
    capturedAt: input.capturedAt,
  };
}

function assertCaptureMetadata(input: ResetCaptureMetadataInput): void {
  for (const [name, value] of [
    ['maintenanceId', input.maintenanceId],
    ['captureId', input.captureId],
    ['sourceScope', input.sourceScope],
    ['capturedAt', input.capturedAt],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError(`Evidence metadata ${name} must be non-empty.`);
    }
  }
  if (input.phase !== 'before' && input.phase !== 'after') {
    throw new TypeError('Evidence phase must be before or after.');
  }
  if (Number.isNaN(Date.parse(input.capturedAt))) {
    throw new TypeError('Evidence capturedAt must be an ISO-compatible time.');
  }
}

function parseR2Manifest(serialized: string): readonly string[] {
  const value: unknown = JSON.parse(serialized);
  if (!Array.isArray(value) || !value.every((key) => typeof key === 'string')) {
    throw new TypeError(
      'R2 manifest must be a JSON array of object-key strings.',
    );
  }
  return normalizeManifest(value);
}

interface StableFileCapture<Value> {
  readonly value: Value;
  readonly identity: LocalFileIdentity;
}

interface StableOpenFile {
  readonly descriptor: number;
  readonly path: string;
  readonly signature: StableFileSignature;
  readonly identity: LocalFileIdentity;
}

interface StableFileSignature {
  readonly device: string;
  readonly inode: string;
  readonly links: string;
  readonly mode: string;
  readonly size: string;
  readonly ctimeNs: string;
  readonly mtimeNs: string;
}

function readStableTextFile(
  path: string,
  afterPreflight?: () => void,
): StableFileCapture<string> {
  const source = openStableLocalFile(path);
  try {
    afterPreflight?.();
    const value = readFileSync(source.descriptor, 'utf8');
    assertOpenFileUnchanged(source);
    return { value, identity: source.identity };
  } finally {
    closeSync(source.descriptor);
  }
}

function readStableD1<Value>(
  path: string,
  read: (database: DatabaseSync) => Value,
  afterTransactionStarted?: () => void,
): StableFileCapture<Value> {
  const source = openStableLocalFile(path);
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(source.path, { readOnly: true });
    database.exec('BEGIN');
    database.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get();
    assertOpenFileUnchanged(source);
    afterTransactionStarted?.();

    let value: Value | undefined;
    let readError: unknown;
    try {
      value = read(database);
    } catch (error) {
      readError = error;
    }
    try {
      assertOpenFileUnchanged(source);
    } catch (stabilityError) {
      rollbackQuietly(database);
      throw stabilityError;
    }
    if (readError) {
      rollbackQuietly(database);
      throw readError;
    }

    database.exec('COMMIT');
    assertOpenFileUnchanged(source);
    return { value: value as Value, identity: source.identity };
  } catch (error) {
    if (database) rollbackQuietly(database);
    throw error;
  } finally {
    database?.close();
    closeSync(source.descriptor);
  }
}

function copyStableLocalFile(
  sourcePath: string,
  targetPath: string,
  mode: number,
): void {
  const source = openStableLocalFile(sourcePath);
  try {
    copyFileSync(source.path, targetPath, mode);
    assertOpenFileUnchanged(source);
  } finally {
    closeSync(source.descriptor);
  }
}

function openStableLocalFile(path: string): StableOpenFile {
  const canonicalPath = assertLocalRegularFile(path);
  let descriptor: number;
  try {
    descriptor = openSync(
      canonicalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch {
    throw new Error('Evidence source path was replaced or changed.');
  }
  try {
    const stats = fstatSync(descriptor, { bigint: true });
    assertStableRegularFile(stats);
    const signature = stableFileSignature(stats);
    const source = {
      descriptor,
      path: canonicalPath,
      signature,
      identity: {
        device: signature.device,
        inode: signature.inode,
        pathHash: sha256(canonicalPath),
        size: signature.size,
        ctimeNs: signature.ctimeNs,
      },
    };
    assertOpenFileUnchanged(source);
    return source;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function assertOpenFileUnchanged(source: StableOpenFile): void {
  const descriptorStats = fstatSync(source.descriptor, { bigint: true });
  assertStableRegularFile(descriptorStats);
  if (!sameJson(stableFileSignature(descriptorStats), source.signature)) {
    throw new Error('Evidence source changed while it was being read.');
  }

  let pathStats: BigIntStats;
  try {
    const link = lstatSync(source.path, { bigint: true });
    if (link.isSymbolicLink() || !link.isFile()) {
      throw new Error('Evidence source path was replaced or changed.');
    }
    pathStats = statSync(source.path, { bigint: true });
  } catch {
    throw new Error('Evidence source path was replaced or changed.');
  }
  assertStableRegularFile(pathStats);
  if (!sameJson(stableFileSignature(pathStats), source.signature)) {
    throw new Error('Evidence source path was replaced or changed.');
  }
}

function assertStableRegularFile(stats: BigIntStats): void {
  if (!stats.isFile()) {
    throw new Error('Evidence sources must be regular local files, not links.');
  }
  if (stats.nlink !== BigInt(1)) {
    throw new Error('Evidence sources must not have hard-link aliases.');
  }
}

function stableFileSignature(stats: BigIntStats): StableFileSignature {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    links: stats.nlink.toString(),
    mode: stats.mode.toString(),
    size: stats.size.toString(),
    ctimeNs: stats.ctimeNs.toString(),
    mtimeNs: stats.mtimeNs.toString(),
  };
}

function rollbackQuietly(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK');
  } catch {
    // No transaction remains after a successful commit or failed begin.
  }
}

function assertLocalRegularFile(path: string): string {
  const absolute = resolve(path);
  const link = lstatSync(absolute);
  if (link.isSymbolicLink() || !link.isFile()) {
    throw new Error('Evidence sources must be regular local files, not links.');
  }
  if (link.nlink !== 1) {
    throw new Error('Evidence sources must not have hard-link aliases.');
  }
  return absolute;
}

function assertNewLocalFile(path: string): string {
  const absolute = resolve(path);
  try {
    lstatSync(absolute);
  } catch (error) {
    if (isMissingFileError(error)) return absolute;
    throw error;
  }
  throw new Error('After evidence target must not already exist.');
}

function assertLocalSnapshotCopy(databaseCopyPath: string): string {
  if (!databaseCopyPath.endsWith('.snapshot.sqlite')) {
    throw new Error('Rehearsal requires local *.snapshot.sqlite copies.');
  }
  return assertLocalRegularFile(databaseCopyPath);
}

function assertNewLocalSnapshotCopy(path: string): string {
  if (!path.endsWith('.snapshot.sqlite')) {
    throw new Error('Rehearsal requires local *.snapshot.sqlite copies.');
  }
  return assertNewLocalFile(path);
}

function isMissingFileError(error: unknown): boolean {
  return (
    isRecord(error) &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLocalFileIdentity(value: unknown): value is LocalFileIdentity {
  return (
    isRecord(value) &&
    ['device', 'inode', 'pathHash', 'size', 'ctimeNs'].every(
      (key) => typeof value[key] === 'string' && value[key].length > 0,
    )
  );
}

function samePhysicalFile(
  left: LocalFileIdentity | undefined,
  right: LocalFileIdentity | undefined,
): boolean {
  return (
    isLocalFileIdentity(left) &&
    isLocalFileIdentity(right) &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
