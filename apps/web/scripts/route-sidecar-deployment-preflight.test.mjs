import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  inspectRouteSidecarDeployment,
  probeRouteSidecarPublicUrl,
} from './route-sidecar-deployment-preflight.ts';

const configUrl = new URL('../wrangler.route-sidecar.jsonc', import.meta.url);
const runbookUrl = new URL(
  '../../../docs/deployment/route-sidecar.md',
  import.meta.url,
);

async function template() {
  return JSON.parse(
    (await readFile(configUrl, 'utf8')).replace(/,\s*([}\]])/gu, '$1'),
  );
}

void test('route sidecar preflight accepts only the isolated private runtime and Google secret name', async () => {
  assert.deepEqual(
    inspectRouteSidecarDeployment({
      config: await template(),
      remoteSecrets: [{ name: 'GOOGLE_MAPS_API_KEY', type: 'secret_text' }],
    }),
    { ready: true, blockers: [] },
  );
});

void test('route sidecar runbook captures secret-name evidence with the installed Wrangler JSON format flag', async () => {
  const source = await readFile(runbookUrl, 'utf8');
  const commands = source.match(/npx wrangler secret list[^\n]+/gu) ?? [];

  assert.equal(commands.length, 2);
  for (const command of commands) {
    assert.match(command, / --format json /u);
    assert.doesNotMatch(command, / --json(?: |$)/u);
  }
});

void test('route sidecar preflight rejects every public route, owner storage, service, and unrelated secret capability', async () => {
  for (const forbidden of [
    { workers_dev: true },
    { preview_urls: true },
    { routes: [{ pattern: 'atlas.example/*' }] },
    { route: 'atlas.example/*' },
    { d1_databases: [{ binding: 'DB' }] },
    { r2_buckets: [{ binding: 'MEDIA' }] },
    { services: [{ binding: 'OWNER', service: 'japan-atlas-owner-poc' }] },
    { vars: { ATLAS_OWNER_PASSWORD: 'forbidden' } },
  ]) {
    const config = { ...(await template()), ...forbidden };
    assert.equal(
      inspectRouteSidecarDeployment({
        config,
        remoteSecrets: [{ name: 'GOOGLE_MAPS_API_KEY', type: 'secret_text' }],
      }).ready,
      false,
    );
  }
  assert.deepEqual(
    inspectRouteSidecarDeployment({
      config: await template(),
      remoteSecrets: [
        { name: 'GOOGLE_MAPS_API_KEY', type: 'secret_text' },
        { name: 'AGENT_JPMAP_HMAC_SECRET', type: 'secret_text' },
      ],
    }),
    {
      ready: false,
      blockers: [
        'secret_evidence_malformed',
        'forbidden_secret:AGENT_JPMAP_HMAC_SECRET',
      ],
    },
  );
});

void test('route sidecar preflight rejects malformed, duplicate, and non-secret evidence without filtering it away', async () => {
  const valid = { name: 'GOOGLE_MAPS_API_KEY', type: 'secret_text' };
  for (const remoteSecrets of [
    [],
    [valid, valid],
    [valid, { name: 123, type: 'secret_text' }],
    [valid, { type: 'secret_text' }],
    [{ ...valid, unexpected: true }],
    [{ name: 'GOOGLE_MAPS_API_KEY', type: 'plain_text' }],
  ]) {
    const result = inspectRouteSidecarDeployment({
      config: await template(),
      remoteSecrets,
    });
    assert.equal(result.ready, false);
    assert.equal(result.blockers.includes('secret_evidence_malformed'), true);
  }
});

void test('public probe accepts only a 404 or unreachable private Worker endpoint', async () => {
  const url = 'https://japan-atlas-route-sidecar.example.workers.dev/';
  assert.deepEqual(
    await probeRouteSidecarPublicUrl(
      url,
      async () => new Response(null, { status: 404 }),
    ),
    { ready: true, blockers: [] },
  );
  assert.deepEqual(
    await probeRouteSidecarPublicUrl(url, async () => {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ENOTFOUND' };
      throw error;
    }),
    { ready: true, blockers: [] },
  );
  assert.deepEqual(
    await probeRouteSidecarPublicUrl(url, async () => {
      throw new Error('offline');
    }),
    { ready: false, blockers: ['public_probe_inconclusive'] },
  );
  for (const status of [200, 302, 401, 403, 500]) {
    assert.deepEqual(
      await probeRouteSidecarPublicUrl(
        url,
        async () => new Response(null, { status }),
      ),
      { ready: false, blockers: ['public_route_reachable'] },
    );
  }
  assert.deepEqual(
    await probeRouteSidecarPublicUrl(
      'https://example.com/',
      async () => new Response(null, { status: 404 }),
    ),
    { ready: false, blockers: ['public_probe_url_invalid'] },
  );
});
