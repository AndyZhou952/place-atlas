import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

interface EvidenceEnvelopeInput {
  readonly sourceConfig: unknown;
  readonly rawEvidence: unknown;
  readonly capturedAt: Date;
}

export function createOwnerPocSeedEvidenceEnvelope(
  input: EvidenceEnvelopeInput,
) {
  if (!isRecord(input.sourceConfig)) {
    throw new Error('Owner PoC source config is invalid.');
  }
  const database = findBinding(input.sourceConfig.d1_databases, 'DB');
  const databaseId = database?.database_id;
  if (
    typeof databaseId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      databaseId,
    )
  ) {
    throw new Error('Owner PoC target D1 database ID is invalid.');
  }
  const results = unwrapWranglerResults(input.rawEvidence);
  if (!results) {
    throw new Error('Wrangler D1 seed evidence is invalid.');
  }
  const capturedAt = input.capturedAt.getTime();
  if (!Number.isFinite(capturedAt)) {
    throw new Error('Owner PoC seed evidence capture time is invalid.');
  }
  return {
    databaseId,
    capturedAt: new Date(capturedAt).toISOString(),
    results,
  };
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    options: {
      config: { type: 'string' },
      rows: { type: 'string' },
    },
    strict: true,
  });
  const configPath = parsed.values.config;
  const rowsPath = parsed.values.rows;
  if (!configPath || !rowsPath) {
    throw new Error('Evidence capture requires --config and --rows.');
  }
  const [sourceConfig, rawEvidence] = await Promise.all([
    readJsonc(configPath),
    readJsonc(rowsPath),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      createOwnerPocSeedEvidenceEnvelope({
        sourceConfig,
        rawEvidence,
        capturedAt: new Date(),
      }),
      undefined,
      2,
    )}\n`,
  );
}

function unwrapWranglerResults(value: unknown): readonly unknown[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    !Array.isArray(value[0].results)
  ) {
    return undefined;
  }
  return value[0].results;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
