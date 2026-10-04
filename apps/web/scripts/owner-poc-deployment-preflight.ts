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
  'FIRECRAWL_API_KEY',
  'ATLAS_ADD_AGENT_TOKEN',
  'GOOGLE_PLACES_API_KEY',
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

  if (!isResourceName(input.sourceConfig.name)) {
    blockers.push('source_worker_not_owner_poc');
  }
  if (
    !isResourceName(sourceDatabase?.database_name) ||
    !isResourceName(sourceBucket?.bucket_name) ||
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
  if (input.builtConfig.name !== input.sourceConfig.name) {
    blockers.push('built_worker_not_owner_poc');
  } else if (
    builtDatabase?.database_name !== sourceDatabase?.database_name ||
    builtDatabase?.database_id !== sourceDatabase?.database_id ||
    builtBucket?.bucket_name !== sourceBucket?.bucket_name ||
    !hasOwnerPocGuard(input.builtConfig.vars)
  ) {
    blockers.push('built_bindings_not_owner_poc');
  }
  if (!hasExactRouteSidecarBinding(input.builtConfig.services)) {
    blockers.push('built_route_sidecar_binding_invalid');
  }
  if (
    hasExactRouteSidecarBinding(input.sourceConfig.services) &&
    hasExactRouteSidecarBinding(input.builtConfig.services) &&
    findBinding(input.sourceConfig.services, 'ROUTE_SIDECAR')?.service !==
      findBinding(input.builtConfig.services, 'ROUTE_SIDECAR')?.service
  ) {
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
      'Deployment requires config, built config, and secret names.',
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
    throw new Error('Owner PoC preflight input is invalid.');
  }
  const result = inspectOwnerPocDeployment({
    sourceConfig,
    builtConfig,
    remoteSecrets,
  });
  const blockers = result.blockers;
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
    isResourceName(binding.service)
  );
}

function isResourceName(value: unknown): boolean {
  return (
    typeof value === 'string' && /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/u.test(value)
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
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
