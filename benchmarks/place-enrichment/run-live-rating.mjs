import { requireTestBaseUrl } from '../live-config.mjs';
// Opt-in production-path rating benchmark: discover, select/research, cancel.
// Gold scores and source URLs are evaluator-side only; the app receives a name
// and address, never an expected rating or Tabelog URL. Nothing is published.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

if (process.env.ALLOW_ADD_LIVE_EVAL !== 'yes') {
  throw new Error('Set ALLOW_ADD_LIVE_EVAL=yes to run live rating research.');
}
if (!process.env.OWNER_TEST_PASSWORD) {
  throw new Error('OWNER_TEST_PASSWORD is required.');
}

const dataset = JSON.parse(
  await readFile(
    resolve('benchmarks/place-enrichment/rating-completion-benchmark.v1.json'),
    'utf8',
  ),
);
const outputPath = resolve(
  process.argv[2] ?? 'benchmarks/runs/rating-live-research.json',
);
const base = requireTestBaseUrl();
const cases = dataset.cases.filter(
  (entry) =>
    entry.mode === 'live_verified' &&
    (!process.env.ADD_LIVE_EVAL_CASE_ID ||
      entry.caseId === process.env.ADD_LIVE_EVAL_CASE_ID),
);
assert.ok(cases.length > 0);

const login = await fetch(`${base}/api/auth/owner`, {
  method: 'POST',
  headers: { origin: base, 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.OWNER_TEST_PASSWORD }),
});
if (!login.ok) throw new Error(`Owner login failed (${login.status}).`);
const cookie = login.headers
  .getSetCookie()
  .map((entry) => entry.split(';', 1)[0])
  .join('; ');
if (!cookie) throw new Error('Owner login did not establish a session.');

const observations = [];
for (const entry of cases) {
  const started = performance.now();
  let session;
  let conversationId;
  const observation = { caseId: entry.caseId };
  try {
    const discovered = await post('/api/catalog-intake/discover', {
      query: entry.query ?? `${entry.canonicalName} ${entry.address}`,
      requestToken: randomUUID(),
    });
    conversationId = discovered.headers.get('x-atlas-web-conversation-id');
    const search = await discovered.json();
    observation.discoveryHttpStatus = discovered.status;
    observation.discoveryStatus = search.status ?? search.code;
    observation.candidateCount = search.candidates?.length ?? 0;
    if (!discovered.ok || !conversationId || !search.sessionId) continue;
    session = {
      id: search.sessionId,
      version: search.sessionVersion,
    };
    // A branch-sensitive benchmark must not guess among multiple candidates.
    if (search.candidates.length !== 1) continue;
    observation.candidate = {
      name: search.candidates[0].transientName,
      address: search.candidates[0].transientAddress,
    };
    const selected = await post(
      '/api/catalog-intake/select',
      {
        sessionId: search.sessionId,
        expectedSessionVersion: search.sessionVersion,
        ordinal: search.candidates[0].ordinal,
        requestResearch: true,
      },
      conversationId,
    );
    const review = await selected.json();
    observation.researchHttpStatus = selected.status;
    observation.researchStatus = review.status ?? review.code;
    if (review.sessionVersion !== undefined)
      session.version = review.sessionVersion;
    if (selected.ok && review.status === 'preview_ready') {
      const rating = review.preview?.tabelog;
      observation.tabelog =
        rating?.status === 'known'
          ? {
              status: 'known',
              score: rating.score,
              url: rating.url,
              provenance: rating.provenance,
              observedAt: rating.observedAt,
            }
          : { status: 'unknown' };
      observation.profileName = review.preview?.profile?.name?.value;
      observation.profileAddress = review.preview?.profile?.address?.value;
      observation.unknownFields = review.preview?.unknownFields;
      observation.warnings = review.preview?.warnings?.map((x) => ({
        code: x.code,
        message: x.message,
      }));
    }
  } finally {
    observation.latencyMs = Math.round(performance.now() - started);
    if (session && conversationId) {
      const cancelled = await post(
        '/api/catalog-intake/cancel',
        { sessionId: session.id, expectedSessionVersion: session.version },
        conversationId,
      );
      observation.cancelled = cancelled.ok;
    }
    observations.push(observation);
    process.stdout.write(
      `${entry.caseId}: ${observation.researchStatus ?? observation.discoveryStatus}, ${observation.tabelog?.status ?? 'no preview'}, ${observation.latencyMs} ms\n`,
    );
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  JSON.stringify(
    {
      benchmarkId: dataset.benchmarkId,
      runAt: new Date().toISOString(),
      endpoint: base,
      observations,
    },
    null,
    2,
  ),
);
process.stdout.write(`Saved ${observations.length} live observations.\n`);

async function post(path, input, conversationId) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
    headers: {
      origin: base,
      cookie,
      'content-type': 'application/json',
      ...(conversationId
        ? { 'x-atlas-web-conversation-id': conversationId }
        : {}),
    },
    body: JSON.stringify({ input }),
  });
}
