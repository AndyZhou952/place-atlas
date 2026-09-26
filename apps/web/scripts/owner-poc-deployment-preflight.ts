const seedEvidenceMaximumAgeMs = 5 * 60 * 1000;

const workerName = 'japan-atlas-owner-poc';
const databaseName = 'japan-atlas-owner-poc';
const bucketName = 'japan-atlas-owner-poc-media';

const requiredSecretNames = [
  'ATLAS_OWNER_PASSWORD',
  'ATLAS_OWNER_SESSION_SECRET',
] as const;

const optionalSecretNames = [
  'AGENT_API_KEY',
  'SEARCH_API_KEY',
  'AGENT_BASE_URL',
  'AGENT_MODEL',
  'AGENT_SETTINGS_SECRET',
] as const;

interface WranglerConfig {
  readonly name?: unknown;
  readonly vars?: unknown;
  readonly d1_databases?: unknown;
  readonly r2_buckets?: unknown;
  readonly services?: unknown;
  readonly [key: string]: unknown;
}

interface RemoteSecret {
  readonly name?: unknown;
  readonly type?: unknown;
}

export function inspectOwnerPocDeployment(input: {
  readonly sourceConfig: WranglerConfig;
  readonly builtConfig: WranglerConfig;
  readonly remoteSecrets: readonly RemoteSecret[];
}): { readonly ready: boolean; readonly blockers: readonly string[] } {
  const blockers: string[] = [];
  const sourceDatabase = findBinding(input.sourceConfig.d1_databases, 'DB');
  const sourceBucket = findBinding(input.sourceConfig.r2_buckets, 'MEDIA');
  const builtDatabase = findBinding(input.builtConfig.d1_databases, 'DB');
  const builtBucket = findBinding(input.builtConfig.r2_buckets, 'MEDIA');

  if (input.sourceConfig.name !== workerName) {
    blockers.push('source_worker_not_owner_poc');
  }
  if (
    sourceDatabase?.database_name !== databaseName ||
    sourceBucket?.bucket_name !== bucketName ||
    !hasOwnerPocGuard(input.sourceConfig.vars)
  ) {
    blockers.push('source_bindings_not_owner_poc');
  }
  if (!hasExactRouteSidecarBinding(input.sourceConfig.services)) {
    blockers.push('source_route_sidecar_binding_invalid');
  }
  if (!hasSafeObservability(input.sourceConfig)) {
    blockers.push('source_observability_invalid');
  }
  if (isPlaceholderId(sourceDatabase?.database_id)) {
    blockers.push('d1_database_id_placeholder');
  }
  if (input.builtConfig.name !== workerName) {
    blockers.push('built_worker_not_owner_poc');
  } else if (
    builtDatabase?.database_name !== databaseName ||
    builtDatabase?.database_id !== sourceDatabase?.database_id ||
    builtBucket?.bucket_name !== bucketName ||
    !hasOwnerPocGuard(input.builtConfig.vars)
  ) {
    blockers.push('built_bindings_not_owner_poc');
  }
  if (!hasExactRouteSidecarBinding(input.builtConfig.services)) {
    blockers.push('built_route_sidecar_binding_invalid');
  }
  if (!hasSafeObservability(input.builtConfig)) {
    blockers.push('built_observability_invalid');
  }
  if (
    containsForbiddenRuntimeMetadata(input.sourceConfig) ||
    containsForbiddenRuntimeMetadata(input.builtConfig)
  ) {
    blockers.push('built_runtime_metadata_forbidden');
  }

  const availableSecrets = new Set(
    input.remoteSecrets
      .filter(
        (secret): secret is { readonly name: string; readonly type: unknown } =>
          secret.type === 'secret_text' && typeof secret.name === 'string',
      )
      .map((secret) => secret.name),
  );
  const expectedSecretNames: string[] = [...requiredSecretNames];
  if (
    isRecord(input.sourceConfig.vars) &&
    input.sourceConfig.vars.CATALOG_INTAKE_GOOGLE_PLACES_MODE === 'enabled'
  ) {
    expectedSecretNames.push('GOOGLE_PLACES_API_KEY');
  }
  for (const name of expectedSecretNames) {
    if (!availableSecrets.has(name)) blockers.push(`missing_secret:${name}`);
  }
  for (const name of availableSecrets) {
    if (/google.*maps|foursquare|transit/iu.test(name)) {
      blockers.push(`forbidden_secret:${name}`);
    } else if (
      !(
        [...expectedSecretNames, ...optionalSecretNames] as readonly string[]
      ).includes(name)
    ) {
      blockers.push(`unexpected_secret:${name}`);
    }
  }

  return { ready: blockers.length === 0, blockers };
}

export function inspectOwnerPocSeed(input: {
  readonly manifest: unknown;
  readonly evidence: unknown;
  readonly sourceArtifactSha256: string;
  readonly targetDatabaseId: string;
  readonly now: Date;
}): { readonly ready: boolean; readonly blockers: readonly string[] } {
  const manifest = parseSeedManifest(input.manifest);
  const evidence = parseSeedEvidence(input.evidence);
  if (!manifest || !evidence) return seedMismatch();
  const capturedAt = Date.parse(evidence.capturedAt);
  const now = input.now.getTime();
  if (
    evidence.databaseId !== input.targetDatabaseId ||
    !Number.isFinite(capturedAt) ||
    new Date(capturedAt).toISOString() !== evidence.capturedAt ||
    !Number.isFinite(now) ||
    capturedAt > now ||
    now - capturedAt > seedEvidenceMaximumAgeMs
  ) {
    return seedMismatch();
  }
  const rows = evidence.rows;
  if (
    manifest.version !== 'owner-poc-seed-v1' ||
    manifest.sourceArtifact !== 'apps/web/features/atlas/verified-items.ts' ||
    manifest.recordCount !== 5 ||
    manifest.sourceSha256 !== input.sourceArtifactSha256 ||
    rows.length !== manifest.recordCount
  ) {
    return seedMismatch();
  }
  const expected = new Map(
    manifest.records.map((record) => [record.id, record.payloadSha256]),
  );
  if (expected.size !== manifest.recordCount) return seedMismatch();
  for (const row of rows) {
    const digest = expected.get(row.id);
    if (
      !digest ||
      digest !== row.payloadSha256 ||
      digest !== sha256(row.payloadJson) ||
      row.seedVersion !== manifest.version ||
      row.sourceArtifact !== manifest.sourceArtifact ||
      row.recordCount !== manifest.recordCount ||
      row.sourceSha256 !== manifest.sourceSha256 ||
      row.payloadAggregateSha256 !== manifest.payloadAggregateSha256
    ) {
      return seedMismatch();
    }
  }
  const aggregate = rows
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((row) => `${row.id}\n${row.payloadJson}`)
    .join('\n');
  return sha256(aggregate) === manifest.payloadAggregateSha256
    ? { ready: true, blockers: [] }
    : seedMismatch();
}

function parseSeedManifest(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.records)) return undefined;
  const records = value.records.flatMap((record) => {
    if (
      !isRecord(record) ||
      typeof record.id !== 'string' ||
      typeof record.payloadSha256 !== 'string'
    ) {
      return [];
    }
    return [{ id: record.id, payloadSha256: record.payloadSha256 }];
  });
  if (
    records.length !== value.records.length ||
    typeof value.version !== 'string' ||
    typeof value.sourceArtifact !== 'string' ||
    !Number.isSafeInteger(value.recordCount) ||
    typeof value.sourceSha256 !== 'string' ||
    typeof value.payloadAggregateSha256 !== 'string'
  ) {
    return undefined;
  }
  return {
    version: value.version,
    sourceArtifact: value.sourceArtifact,
    recordCount: value.recordCount as number,
    sourceSha256: value.sourceSha256,
    payloadAggregateSha256: value.payloadAggregateSha256,
    records,
  };
}

function parseSeedEvidence(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.databaseId !== 'string' ||
    typeof value.capturedAt !== 'string' ||
    !Array.isArray(value.results)
  ) {
    return undefined;
  }
  const rowsValue = value.results;
  const rows = rowsValue.flatMap((row) => {
    if (
      !isRecord(row) ||
      typeof row.seed_version !== 'string' ||
      typeof row.source_artifact !== 'string' ||
      !Number.isSafeInteger(row.record_count) ||
      typeof row.source_sha256 !== 'string' ||
      typeof row.payload_aggregate_sha256 !== 'string' ||
      typeof row.id !== 'string' ||
      typeof row.payload_sha256 !== 'string' ||
      typeof row.payload_json !== 'string'
    ) {
      return [];
    }
    return [
      {
        seedVersion: row.seed_version,
        sourceArtifact: row.source_artifact,
        recordCount: row.record_count as number,
        sourceSha256: row.source_sha256,
        payloadAggregateSha256: row.payload_aggregate_sha256,
        id: row.id,
        payloadSha256: row.payload_sha256,
        payloadJson: row.payload_json,
      },
    ];
  });
  return rows.length === rowsValue.length
    ? { databaseId: value.databaseId, capturedAt: value.capturedAt, rows }
    : undefined;
}

function seedMismatch() {
  return { ready: false as const, blockers: ['seed_manifest_mismatch'] };
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      config: { type: 'string' },
      'built-config': { type: 'string' },
      'secret-list': { type: 'string' },
      'seed-manifest': { type: 'string' },
      'seed-evidence': { type: 'string' },
    },
    strict: true,
  });
  const configPath = parsed.values.config;
  const builtConfigPath = parsed.values['built-config'];
  const secretListPath = parsed.values['secret-list'];
  const seedManifestPath = parsed.values['seed-manifest'];
  const seedEvidencePath = parsed.values['seed-evidence'];
  if (!configPath || !builtConfigPath || !secretListPath) {
    throw new Error(
      'Deployment requires config, built config, and secret names.',
    );
  }
  if (Boolean(seedManifestPath) !== Boolean(seedEvidencePath)) {
    throw new Error(
      'Optional seed validation requires both seed manifest and remote seed evidence.',
    );
  }
  const [
    sourceConfig,
    builtConfig,
    remoteSecrets,
    seedManifest,
    seedEvidence,
    sourceArtifact,
  ] = await Promise.all([
    readJsonc(configPath),
    readJsonc(builtConfigPath),
    readJsonc(secretListPath),
    seedManifestPath ? readJsonc(seedManifestPath) : undefined,
    seedEvidencePath ? readJsonc(seedEvidencePath) : undefined,
    readFile(new URL('../features/atlas/verified-items.ts', import.meta.url)),
  ]);
  if (
    !isRecord(sourceConfig) ||
    !isRecord(builtConfig) ||
    !Array.isArray(remoteSecrets)
  ) {
    throw new Error('Owner PoC preflight input is invalid.');
  }
  const result = inspectOwnerPocDeployment({
    sourceConfig,
    builtConfig,
    remoteSecrets,
  });
  const sourceDatabase = findBinding(sourceConfig.d1_databases, 'DB');
  const targetDatabaseId =
    typeof sourceDatabase?.database_id === 'string'
      ? sourceDatabase.database_id
      : '';
  const seedResult =
    seedManifestPath && seedEvidencePath
      ? inspectOwnerPocSeed({
          manifest: seedManifest,
          evidence: seedEvidence,
          sourceArtifactSha256: sha256(sourceArtifact),
          targetDatabaseId,
          now: new Date(),
        })
      : { ready: true, blockers: [] };
  const blockers = [...result.blockers, ...seedResult.blockers];
  if (blockers.length > 0) {
    throw new Error(`Owner PoC deploy blocked: ${blockers.join(', ')}`);
  }
  process.stdout.write('Owner PoC deployment preflight passed.\n');
}

async function readJsonc(path: string): Promise<unknown> {
  const source = await readFile(path, 'utf8');
  return JSON.parse(source.replace(/,\s*([}\]])/gu, '$1')) as unknown;
}

function findBinding(value: unknown, binding: string) {
  if (!Array.isArray(value)) return undefined;
  return value.find(
    (candidate): candidate is Record<string, unknown> =>
      isRecord(candidate) && candidate.binding === binding,
  );
}

function hasOwnerPocGuard(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.ATLAS_DEPLOYMENT_ENV === 'owner-poc' &&
    value.ATLAS_DATASET === 'owner-poc' &&
    (value.CATALOG_INTAKE_GOOGLE_PLACES_MODE === 'enabled' ||
      value.CATALOG_INTAKE_GOOGLE_PLACES_MODE === 'disabled') &&
    value.CATALOG_INTAKE_DURABLE_GEOCODER_MODE === 'enabled'
  );
}

function hasSafeObservability(config: WranglerConfig): boolean {
  if (!isRecord(config.observability)) return false;
  const observability = config.observability;
  if (!isRecord(observability.logs)) return false;
  return (
    config.preview_urls === false &&
    observability.enabled === true &&
    observability.redact_query_string === true &&
    typeof observability.head_sampling_rate === 'number' &&
    observability.head_sampling_rate > 0 &&
    observability.head_sampling_rate <= 0.05 &&
    observability.logs.enabled === true &&
    observability.logs.invocation_logs === false &&
    typeof observability.logs.head_sampling_rate === 'number' &&
    observability.logs.head_sampling_rate > 0 &&
    observability.logs.head_sampling_rate <= 0.05
  );
}

function hasExactRouteSidecarBinding(value: unknown): boolean {
  if (value === undefined || (Array.isArray(value) && value.length === 0))
    return true;
  if (!Array.isArray(value) || value.length !== 1) return false;
  const binding = value[0];
  return (
    isRecord(binding) &&
    Object.keys(binding).every((key) =>
      ['binding', 'service', 'environment'].includes(key),
    ) &&
    (binding.environment === undefined ||
      binding.environment === 'production') &&
    binding.binding === 'ROUTE_SIDECAR' &&
    binding.service === 'japan-atlas-route-sidecar'
  );
}

function isPlaceholderId(value: unknown): boolean {
  return (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    ) ||
    /^0{8}-0{4}-[0-9a-f]{4}-[0-9a-f]{4}-0{12}$/iu.test(value)
  );
}

function containsForbiddenRuntimeMetadata(config: WranglerConfig): boolean {
  return /foursquare|google.*maps.*api.*key|transit|site-creator|appgprj_|openai.*sites|agent-poc-readonly|japan-atlas-agent-poc-fixture/iu.test(
    JSON.stringify(config),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
