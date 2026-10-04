import { randomUUID } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exactCandidateMatch,
  exactProfileIdentityMatch,
  scoreCatalogHoursCase,
  validateCatalogHoursContract,
} from './catalog-hours-score.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL('./catalog-hours.v1.json', import.meta.url), 'utf8'),
);
const inventory = JSON.parse(
  await readFile(
    new URL('./catalog-hours-inventory.v1.json', import.meta.url),
    'utf8',
  ),
);
const contract = validateCatalogHoursContract(manifest, inventory);
if (!contract.pass)
  throw new Error(
    `Catalog-hours contract failed:\n${contract.errors.join('\n')}`,
  );

function parseArgs(args) {
  let offset = 0;
  let limit;
  let output;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--limit') {
      limit = Number(args[++i]);
    } else if (arg.startsWith('--limit=')) {
      limit = Number(arg.slice('--limit='.length));
    } else if (arg === '--offset') {
      offset = Number(args[++i]);
    } else if (arg.startsWith('--offset=')) {
      offset = Number(arg.slice('--offset='.length));
    } else if (arg === '--out') {
      output = args[++i];
    } else if (arg.startsWith('--out=')) {
      output = arg.slice('--out='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= manifest.cases.length
  )
    throw new Error(
      `--offset must be an integer from 0 to ${manifest.cases.length - 1}.`,
    );
  if (limit === undefined) limit = manifest.cases.length - offset;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    offset + limit > manifest.cases.length
  )
    throw new Error(
      `--limit must be an integer from 1 to ${manifest.cases.length - offset}.`,
    );
  return { limit, offset, output };
}
const { limit, offset, output } = parseArgs(process.argv.slice(2));
const partialReport = offset > 0 || offset + limit < manifest.cases.length;
const endpointText = process.env.ATLAS_ADD_AGENT_URL;
if (!endpointText)
  throw new Error(
    'Set ATLAS_ADD_AGENT_URL to the deployed Add Agent endpoint.',
  );
const endpoint = new URL(endpointText);
if (
  endpoint.protocol !== 'https:' ||
  endpoint.pathname !== '/api/agent/catalog-intake' ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash
)
  throw new Error('ATLAS_ADD_AGENT_URL must be an HTTPS Add Agent endpoint.');
const token =
  process.env.ATLAS_ADD_AGENT_TOKEN ||
  (
    await readFile(resolve(root, '../../.wrangler/add-agent-token'), 'utf8')
  ).trim();
if (!token) throw new Error('Set ATLAS_ADD_AGENT_TOKEN.');

// The backend scopes live intake sessions to one conversation per credential.
const lockPath = resolve(root, '../../.wrangler/catalog-hours-eval.lock');
mkdirSync(dirname(lockPath), { recursive: true });
let lockDescriptor;
try {
  lockDescriptor = openSync(lockPath, 'wx', 0o600);
} catch (error) {
  if (error?.code === 'EEXIST')
    throw new Error(
      'Another catalog-hours evaluation is active. Only one runner may use this credential at a time; run slices sequentially.',
    );
  throw error;
}
writeFileSync(
  lockDescriptor,
  JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
);
closeSync(lockDescriptor);
process.on('exit', () => {
  try {
    unlinkSync(lockPath);
  } catch {}
});

function sanitize(value, key = '') {
  if (
    /authorization|bearer|cookie|e-?mail|phone|password|requesttoken|sessionid|conversationid|token/iu.test(
      key,
    )
  )
    return '[redacted]';
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitize(child, childKey),
      ]),
    );
  if (typeof value === 'string')
    return value.replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
      '[redacted-email]',
    );
  return value;
}

async function call(operation, input, conversationId) {
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(90_000),
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(conversationId
        ? { 'x-atlas-agent-conversation-id': conversationId }
        : {}),
    },
    body: JSON.stringify({ operation: `catalog.intake.${operation}`, input }),
  });
  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch {
    body = {
      diagnostic: 'non_json_response',
      byteLength: Buffer.byteLength(responseText),
    };
  }
  return {
    status: response.status,
    conversationId:
      response.headers.get('x-atlas-agent-conversation-id') ?? conversationId,
    body,
  };
}

function providerFailure(response) {
  return Boolean(
    !response ||
    response.status >= 500 ||
    [
      'provider_unavailable',
      'research_unavailable',
      'unexpected_failure',
    ].includes(response.body?.code),
  );
}

const reports = [];
const outputPath = output ? resolve(output) : undefined;
if (outputPath) await mkdir(dirname(outputPath), { recursive: true });
const runStartedAt = new Date().toISOString();

function makeReportDoc(inProgress) {
  const passed = reports.filter((entry) => entry.pass).length;
  return {
    benchmarkId: manifest.benchmarkId,
    inventoryId: inventory.inventoryId,
    runStartedAt,
    updatedAt: new Date().toISOString(),
    endpointHost: endpoint.hostname,
    modelSource: 'deployed Add Agent configured provider',
    modelIdentifierObserved: false,
    goldFieldsSentToModel: false,
    noConfirmOrSave: true,
    partialReport,
    inProgress,
    requestedOffset: offset,
    requestedLimit: limit,
    passed,
    total: reports.length,
    perStageFailures: reports.reduce((counts, entry) => {
      if (!entry.pass)
        counts[entry.diagnostics.stage] =
          (counts[entry.diagnostics.stage] ?? 0) + 1;
      return counts;
    }, {}),
    cleanupFailures: reports.filter(
      (entry) => entry.diagnostics.cleanup.status !== 'cancelled',
    ).length,
    cases: reports,
  };
}

async function writeCheckpoint(inProgress) {
  if (outputPath)
    await writeFile(
      outputPath,
      JSON.stringify(makeReportDoc(inProgress), null, 2),
    );
}

for (const sample of manifest.cases.slice(offset, offset + limit)) {
  const inventoryItem = inventory.cases.find(
    (item) => item.itemId === sample.itemId,
  );
  const started = Date.now();
  let sessionId;
  let sessionVersion;
  let conversationId;
  let discover;
  let select;
  let candidate;
  let selectionBasis;
  let preview;
  let stage = 'discover';
  let providerUnavailable = false;
  let transportFailure = false;
  let branchIdentity = { checked: false, pass: false };
  let cleanup = { attempted: false, status: 'not_started' };
  let score = { pass: false, checks: {}, failure: '' };

  try {
    // The model receives only public subject identity. Gold fields never leave this runner.
    discover = await call(
      'discover',
      {
        query: `${inventoryItem.name} ${inventoryItem.address}`,
        requestToken: `catalog-hours-${randomUUID()}`,
      },
      conversationId,
    );
    conversationId = discover.conversationId;
    sessionId = discover.body?.sessionId;
    sessionVersion = discover.body?.sessionVersion;
    const candidates = discover.body?.candidates;
    providerUnavailable = providerFailure(discover);
    const matches = Array.isArray(candidates)
      ? candidates.filter((item) => exactCandidateMatch(inventoryItem, item))
      : [];
    if (discover.status !== 200 || !Array.isArray(candidates)) {
      score = {
        pass: false,
        checks: {},
        failure: 'candidate_list_missing',
      };
      stage = 'discover';
    } else {
      if (matches.length === 1) {
        candidate = matches[0];
        selectionBasis = 'exact_name_and_address';
      } else if (matches.length === 0 && candidates.length === 1) {
        candidate = candidates[0];
        selectionBasis = 'single_candidate_pending_branch_verification';
      }
      if (!candidate) {
        score = {
          pass: false,
          checks: {},
          failure:
            matches.length > 1
              ? 'multiple_exact_branches'
              : 'ambiguous_candidate_list',
        };
        stage = 'discover';
      } else {
        stage = 'select';
        select = await call(
          'select',
          {
            sessionId,
            expectedSessionVersion: sessionVersion,
            ordinal: candidate.ordinal,
          },
          conversationId,
        );
        conversationId = select.conversationId;
        sessionVersion = select.body?.sessionVersion ?? sessionVersion;
        providerUnavailable ||= providerFailure(select);
        if (select.status === 200 && select.body?.status === 'preview_ready') {
          preview = select.body.preview;
          branchIdentity = {
            checked: true,
            pass: exactProfileIdentityMatch(sample, preview?.profile),
          };
          if (!branchIdentity.pass) {
            stage = 'identity';
            score = {
              pass: false,
              checks: {},
              failure: 'selected_profile_branch_mismatch',
            };
          } else {
            stage = 'score';
            score = scoreCatalogHoursCase(sample, preview?.profile);
          }
        } else {
          score = {
            pass: false,
            checks: {},
            failure:
              select.body?.code ??
              select.body?.status ??
              `http_${select.status}`,
          };
        }
      }
    }
  } catch (error) {
    providerUnavailable = true;
    transportFailure = true;
    score = {
      pass: false,
      checks: {},
      failure: error instanceof Error ? error.message : 'transport_failure',
    };
  } finally {
    if (sessionId && Number.isInteger(sessionVersion) && conversationId) {
      cleanup = { attempted: true, status: 'failed' };
      try {
        const cancelled = await call(
          'cancel',
          { sessionId, expectedSessionVersion: sessionVersion },
          conversationId,
        );
        cleanup = {
          attempted: true,
          status:
            cancelled.body?.status ??
            cancelled.body?.code ??
            `http_${cancelled.status}`,
          httpStatus: cancelled.status,
          response: sanitize(cancelled.body),
        };
      } catch {
        cleanup = { attempted: true, status: 'failed' };
      }
    } else if (sessionId) {
      cleanup = { attempted: false, status: 'session_state_missing' };
    }
  }

  const pass = score.pass && cleanup.status === 'cancelled';
  const report = {
    caseId: sample.id,
    itemId: sample.itemId,
    name: sample.name,
    pass,
    score,
    branchIdentity,
    candidate: sanitize(candidate),
    selectionBasis: selectionBasis ?? null,
    preview: sanitize(preview),
    diagnostics: {
      stage,
      providerUnavailable,
      transportFailure,
      discover: discover
        ? sanitize({ status: discover.status, body: discover.body })
        : { status: 'not_received' },
      select: select
        ? sanitize({ status: select.status, body: select.body })
        : { status: 'not_run' },
      cleanup,
      elapsedMs: Date.now() - started,
    },
  };
  reports.push(report);
  await writeCheckpoint(true);
  process.stdout.write(
    `${sample.id}: ${pass ? 'pass' : 'fail'}; stage=${stage}; ${
      score.failure ??
      (Object.entries(score.checks)
        .filter(([, check]) => !check.pass)
        .map(([name, check]) => `${name}:${check.failure}`)
        .join(', ') ||
        'checks passed')
    }; cleanup=${cleanup.status}\n`,
  );
}

const passed = reports.filter((entry) => entry.pass).length;
await writeCheckpoint(false);
if (outputPath) process.stdout.write(`Saved report: ${outputPath}\n`);
process.stdout.write(
  `catalog-hours: ${passed}/${reports.length} passed${partialReport ? ' (partial diagnostic subset)' : ''}\n`,
);
if (passed !== reports.length) process.exitCode = 1;
