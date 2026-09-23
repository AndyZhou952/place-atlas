import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const workerName = 'japan-atlas-agent-poc';
const databaseName = 'japan-atlas-agent-poc-fixture';
const bucketName = 'japan-atlas-agent-poc-media-fixture';
const requiredSecretNames = [
  'AGENT_JPMAP_KEY_ID',
  'AGENT_JPMAP_HMAC_SECRET',
  'AGENT_OWNER_ACTOR_ID',
  'AGENT_OWNER_CONVERSATION_ID',
  'GOOGLE_MAPS_API_KEY',
] as const;

interface WranglerConfig {
  readonly name?: unknown;
  readonly vars?: unknown;
  readonly d1_databases?: unknown;
  readonly r2_buckets?: unknown;
  readonly [key: string]: unknown;
}

interface RemoteSecret {
  readonly name?: unknown;
  readonly type?: unknown;
}

export function inspectAgentPocDeployment(input: {
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
    blockers.push('source_worker_not_isolated');
  }
  if (
    sourceDatabase?.database_name !== databaseName ||
    sourceBucket?.bucket_name !== bucketName ||
    !hasReadonlyFixtureGuard(input.sourceConfig.vars)
  ) {
    blockers.push('source_bindings_not_isolated');
  }
  if (isPlaceholderId(sourceDatabase?.database_id)) {
    blockers.push('d1_database_id_placeholder');
  }
  if (input.builtConfig.name !== workerName) {
    blockers.push('built_worker_not_isolated');
  } else if (
    builtDatabase?.database_name !== databaseName ||
    builtDatabase?.database_id !== sourceDatabase?.database_id ||
    builtBucket?.bucket_name !== bucketName ||
    !hasReadonlyFixtureGuard(input.builtConfig.vars) ||
    containsSitesMetadata(input.builtConfig)
  ) {
    blockers.push('built_bindings_not_isolated');
  }

  const availableSecrets = new Set(
    input.remoteSecrets
      .filter((secret) => secret.type === 'secret_text')
      .map((secret) => secret.name),
  );
  for (const name of requiredSecretNames) {
    if (!availableSecrets.has(name)) blockers.push(`missing_secret:${name}`);
  }
  return { ready: blockers.length === 0, blockers };
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      config: { type: 'string' },
      'built-config': { type: 'string' },
      'secret-list': { type: 'string' },
    },
    strict: true,
  });
  const configPath = parsed.values.config;
  const builtConfigPath = parsed.values['built-config'];
  const secretListPath = parsed.values['secret-list'];
  if (!configPath || !builtConfigPath || !secretListPath) {
    throw new Error(
      'Agent PoC deploy requires --config, --built-config, and --secret-list.',
    );
  }
  const [sourceConfig, builtConfig, remoteSecrets] = await Promise.all([
    readJsonc(configPath),
    readJsonc(builtConfigPath),
    readJsonc(secretListPath),
  ]);
  if (
    !isRecord(sourceConfig) ||
    !isRecord(builtConfig) ||
    !Array.isArray(remoteSecrets)
  ) {
    throw new Error('Agent PoC preflight input is invalid.');
  }
  const result = inspectAgentPocDeployment({
    sourceConfig,
    builtConfig,
    remoteSecrets,
  });
  if (!result.ready) {
    throw new Error(`Agent PoC deploy blocked: ${result.blockers.join(', ')}`);
  }
  process.stdout.write('Agent PoC deployment preflight passed.\n');
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

function hasReadonlyFixtureGuard(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.ATLAS_DEPLOYMENT_ENV === 'agent-poc-readonly' &&
    value.ATLAS_DATASET === 'fixture'
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

function containsSitesMetadata(config: WranglerConfig): boolean {
  return /site-creator|appgprj_|openai.*sites|\.openai\/hosting/iu.test(
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
