import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const workerName = 'japan-atlas-route-sidecar';
const requiredSecret = 'GOOGLE_MAPS_API_KEY';
const allowedConfigKeys = new Set([
  '$schema',
  'name',
  'main',
  'compatibility_date',
  'compatibility_flags',
  'workers_dev',
  'preview_urls',
  'routes',
]);

interface WranglerConfig {
  readonly [key: string]: unknown;
}

interface RemoteSecret {
  readonly name?: unknown;
  readonly type?: unknown;
}

export function inspectRouteSidecarDeployment(input: {
  readonly config: WranglerConfig;
  readonly remoteSecrets: readonly RemoteSecret[];
}): { readonly ready: boolean; readonly blockers: readonly string[] } {
  const blockers: string[] = [];
  const config = input.config;
  if (
    config.name !== workerName ||
    config.main !== 'route-sidecar/worker.ts' ||
    config.compatibility_date !== '2026-09-21' ||
    !Array.isArray(config.compatibility_flags) ||
    config.compatibility_flags.length !== 1 ||
    config.compatibility_flags[0] !== 'nodejs_compat'
  ) {
    blockers.push('sidecar_identity_or_runtime_mismatch');
  }
  if (
    config.workers_dev !== false ||
    config.preview_urls !== false ||
    !Array.isArray(config.routes) ||
    config.routes.length !== 0 ||
    'route' in config
  ) {
    blockers.push('public_route_enabled');
  }
  if (Object.keys(config).some((key) => !allowedConfigKeys.has(key))) {
    blockers.push('forbidden_runtime_binding');
  }

  if (!input.remoteSecrets.some(isExactGoogleSecret)) {
    blockers.push(`missing_secret:${requiredSecret}`);
  }
  if (
    input.remoteSecrets.length !== 1 ||
    !isExactGoogleSecret(input.remoteSecrets[0])
  ) {
    blockers.push('secret_evidence_malformed');
  }
  for (const secret of input.remoteSecrets) {
    if (
      isRecord(secret) &&
      typeof secret.name === 'string' &&
      secret.name !== requiredSecret
    ) {
      blockers.push(`forbidden_secret:${secret.name}`);
    }
  }
  return { ready: blockers.length === 0, blockers };
}

export async function probeRouteSidecarPublicUrl(
  value: string,
  fetchPublic: (url: string, init: RequestInit) => Promise<Response>,
): Promise<{ readonly ready: boolean; readonly blockers: readonly string[] }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ready: false, blockers: ['public_probe_url_invalid'] };
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    !url.hostname.startsWith(`${workerName}.`) ||
    !url.hostname.endsWith('.workers.dev')
  ) {
    return { ready: false, blockers: ['public_probe_url_invalid'] };
  }
  try {
    const response = await fetchPublic(url.href, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
    });
    return response.status === 404
      ? { ready: true, blockers: [] }
      : { ready: false, blockers: ['public_route_reachable'] };
  } catch (error) {
    return isDnsNotFound(error)
      ? { ready: true, blockers: [] }
      : { ready: false, blockers: ['public_probe_inconclusive'] };
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      config: { type: 'string' },
      'secret-list': { type: 'string' },
      'public-url': { type: 'string' },
    },
    strict: true,
  });
  const configPath = parsed.values.config;
  const secretListPath = parsed.values['secret-list'];
  const publicUrl =
    parsed.values['public-url'] ?? process.env.ROUTE_SIDECAR_PUBLIC_URL;
  if (!configPath || !secretListPath || !publicUrl) {
    throw new Error(
      'Route Sidecar preflight requires config, redacted secret-name list, and public URL.',
    );
  }
  const config = JSON.parse(
    stripTrailingCommas(await readFile(configPath, 'utf8')),
  );
  const remoteSecrets = JSON.parse(await readFile(secretListPath, 'utf8'));
  if (!isRecord(config) || !Array.isArray(remoteSecrets)) {
    throw new Error('Route Sidecar preflight evidence is malformed.');
  }
  const deployment = inspectRouteSidecarDeployment({ config, remoteSecrets });
  const publicProbe = await probeRouteSidecarPublicUrl(publicUrl, fetch);
  const blockers = [...deployment.blockers, ...publicProbe.blockers];
  if (blockers.length > 0) {
    throw new Error(`Route Sidecar preflight failed: ${blockers.join(', ')}`);
  }
  process.stdout.write('Route Sidecar preflight passed.\n');
}

function stripTrailingCommas(value: string): string {
  return value.replace(/,\s*([}\]])/gu, '$1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExactGoogleSecret(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, 'name') &&
    Object.hasOwn(value, 'type') &&
    value.name === requiredSecret &&
    value.type === 'secret_text'
  );
}

function isDnsNotFound(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.cause)) return false;
  return value.cause.code === 'ENOTFOUND' || value.cause.code === 'EAI_NONAME';
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
