// Run the deployed Add discovery endpoint without selecting or publishing a place.
// Gold actions and identities are never included in requests to the application.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

if (process.env.ALLOW_ADD_LIVE_EVAL !== 'yes') {
  throw new Error('Set ALLOW_ADD_LIVE_EVAL=yes to run live discovery.');
}
if (!process.env.OWNER_TEST_PASSWORD) {
  throw new Error('OWNER_TEST_PASSWORD is required.');
}

const datasetPath = resolve(
  process.argv[2] ?? 'evals/place-resolution/place-resolution-gold.v1.json',
);
const outputPath = resolve(
  process.argv[3] ?? 'evals/runs/place-resolution-live-discovery.json',
);
const base = (
  process.env.ATLAS_BASE_URL ||
  'https://japan-atlas-owner-poc.japan-atlas-poc.workers.dev'
).replace(/\/$/u, '');
const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
assert.ok(Array.isArray(dataset.cases));
const limit = Number(process.env.ADD_LIVE_EVAL_LIMIT || dataset.cases.length);
assert.ok(Number.isInteger(limit) && limit > 0);
const selectedCases = process.env.ADD_LIVE_EVAL_CASE_ID
  ? dataset.cases.filter(
      (entry) => entry.caseId === process.env.ADD_LIVE_EVAL_CASE_ID,
    )
  : dataset.cases.slice(0, limit);
assert.ok(selectedCases.length > 0, 'No benchmark case selected.');

const login = await fetch(`${base}/api/auth/owner`, {
  method: 'POST',
  headers: { origin: base, 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.OWNER_TEST_PASSWORD }),
});
if (!login.ok) throw new Error(`Owner login failed (${login.status}).`);
const cookies = login.headers
  .getSetCookie()
  .map((entry) => entry.split(';', 1)[0])
  .join('; ');
if (!cookies) throw new Error('Owner login did not establish a session.');

const observations = [];
for (const { caseId, query } of selectedCases) {
  const started = performance.now();
  const response = await fetch(`${base}/api/catalog-intake/discover`, {
    method: 'POST',
    headers: {
      origin: base,
      cookie: cookies,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ input: { query, requestToken: randomUUID() } }),
  });
  const conversationId = response.headers.get('x-atlas-web-conversation-id');
  const body = await response.json();
  const observation = {
    caseId,
    query,
    httpStatus: response.status,
    latencyMs: Math.round(performance.now() - started),
    ...(response.ok
      ? {
          status: body.status,
          candidates: body.candidates,
          hasMore: body.hasMore,
        }
      : {
          errorCode: body.code ?? 'unknown',
          errorMessage: body.message ?? 'Discovery failed',
        }),
  };
  observations.push(observation);
  process.stdout.write(
    `${caseId}: ${observation.status ?? observation.errorCode}, ${observation.candidates?.length ?? 0} candidates, ${observation.latencyMs} ms\n`,
  );

  if (response.ok && conversationId && body.sessionId) {
    const cancelled = await fetch(`${base}/api/catalog-intake/cancel`, {
      method: 'POST',
      headers: {
        origin: base,
        cookie: cookies,
        'content-type': 'application/json',
        'x-atlas-web-conversation-id': conversationId,
      },
      body: JSON.stringify({
        input: {
          sessionId: body.sessionId,
          expectedSessionVersion: body.sessionVersion,
        },
      }),
    });
    if (!cancelled.ok) {
      throw new Error(`${caseId}: transient Add session cancellation failed.`);
    }
  }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  JSON.stringify(
    {
      datasetId: dataset.datasetId,
      runAt: new Date().toISOString(),
      endpoint: `${base}/api/catalog-intake/discover`,
      observations,
    },
    null,
    2,
  ),
);
process.stdout.write(`Saved ${observations.length} observations.\n`);
