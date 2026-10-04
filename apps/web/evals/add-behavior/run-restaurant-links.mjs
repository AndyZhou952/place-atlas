import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreRestaurantHours } from './restaurant-hours-score.mjs';
import { scoreRestaurantLinks } from './restaurant-links-score.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const benchmark = JSON.parse(
  await readFile(
    new URL('./restaurant-links.v1.json', import.meta.url),
    'utf8',
  ),
);
const hoursBenchmark = process.argv.includes('--hours')
  ? JSON.parse(
      await readFile(
        new URL('./restaurant-hours.v1.json', import.meta.url),
        'utf8',
      ),
    )
  : undefined;
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

function sanitize(value, key = '') {
  if (
    /authorization|bearer|cookie|e-?mail|phone|password|requesttoken|sessionid|conversationid|token/iu.test(
      key,
    )
  )
    return '[redacted]';
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitize(child, childKey),
      ]),
    );
  }
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
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = {
      diagnostic: 'non_json_response',
      byteLength: Buffer.byteLength(text),
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

function selectCandidate(sample, candidates) {
  const matches = candidates.filter((candidate) =>
    (sample.identity.nameVariants ?? [sample.identity.nameIncludes]).some(
      (names) =>
        names.every((part) =>
          String(candidate.transientName ?? '')
            .normalize('NFKC')
            .toLowerCase()
            .includes(part.normalize('NFKC').toLowerCase()),
        ),
    ),
  );
  return matches.length === 1 ? matches[0] : null;
}

const reports = [];
for (const sample of benchmark.cases) {
  const started = Date.now();
  let sessionId;
  let sessionVersion;
  let conversationId;
  let discover;
  let select;
  let candidate;
  let preview;
  let cleanup = { attempted: false, status: 'not_started' };
  let stage = 'discover';
  let topLevelProviderFailure = false;
  let transportFailure = false;

  try {
    // Deliberately send only the user query and a fresh idempotency token.
    discover = await call(
      'discover',
      { query: sample.query, requestToken: `restaurant-links-${randomUUID()}` },
      conversationId,
    );
    conversationId = discover.conversationId;
    sessionId = discover.body?.sessionId;
    sessionVersion = discover.body?.sessionVersion;
    const candidates = discover.body?.candidates ?? [];
    candidate = selectCandidate(sample, candidates);
    topLevelProviderFailure = providerFailure(discover);

    if (discover.status !== 200 || !Array.isArray(candidates) || !candidate) {
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
      topLevelProviderFailure ||= providerFailure(select);
      if (select.status === 200 && select.body?.status === 'preview_ready')
        preview = select.body.preview;
    }
  } catch {
    topLevelProviderFailure = true;
    transportFailure = true;
  } finally {
    if (sessionId && Number.isInteger(sessionVersion) && conversationId) {
      cleanup = { attempted: true, status: 'failed' };
      try {
        const cancelled = await call(
          'cancel',
          { sessionId, expectedSessionVersion: sessionVersion },
          conversationId,
        );
        conversationId = cancelled.conversationId;
        cleanup = {
          attempted: true,
          status:
            cancelled.body?.status ?? cancelled.body?.code ?? cancelled.status,
          httpStatus: cancelled.status,
          response: sanitize(cancelled.body),
        };
      } catch {
        cleanup = { attempted: true, status: 'failed' };
      }
    }
  }

  const observation = {
    stage,
    candidate,
    preview,
    providerFailure: topLevelProviderFailure,
  };
  const score = scoreRestaurantLinks(sample, observation);
  if (hoursBenchmark) {
    const hours = hoursBenchmark.cases.find(
      (item) => item.listingUrl === sample.expected.tabelogUrl,
    );
    if (!hours) throw new Error('Missing hours benchmark case.');
    const hoursScore = scoreRestaurantHours(hours, preview?.profile);
    score.checks = { ...score.checks, ...hoursScore.checks };
    score.pass &&= hoursScore.pass;
  }
  const passed = score.pass && cleanup.status === 'cancelled';
  const report = {
    caseId: sample.id,
    pass: passed,
    score,
    candidate: sanitize(candidate),
    preview: sanitize(preview),
    diagnostics: {
      stage,
      providerFailure: topLevelProviderFailure,
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
  process.stdout.write(
    `${sample.id}: ${passed ? 'pass' : 'fail'}; ${
      Object.entries(score.checks)
        .filter(([, check]) => !check.pass)
        .map(([name, check]) => `${name}:${check.failure}`)
        .join(', ') || 'checks passed'
    }; cleanup=${cleanup.status}\n`,
  );
}

const passed = reports.filter((entry) => entry.pass).length;
const outputPath = process.argv[2];
if (outputPath) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    JSON.stringify(
      {
        benchmarkId: benchmark.benchmarkId,
        ...(hoursBenchmark
          ? { hoursBenchmarkId: hoursBenchmark.benchmarkId }
          : {}),
        runAt: new Date().toISOString(),
        endpoint: endpoint.href,
        modelSource: 'deployed Add Agent configured provider',
        modelIdentifierObserved: false,
        noConfirmOrSave: true,
        passed,
        total: reports.length,
        cases: reports,
      },
      null,
      2,
    ),
  );
  process.stdout.write(`Saved private report: ${absolutePath}\n`);
}
process.stdout.write(`restaurant-links: ${passed}/${reports.length} passed\n`);
if (passed !== reports.length) process.exitCode = 1;
