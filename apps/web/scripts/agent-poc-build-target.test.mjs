import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createWebViteConfig } from '../vite.config.ts';
import { inspectAgentPocDeployment } from './agent-poc-deployment-preflight.ts';

const appRoot = path.resolve(import.meta.dirname, '..');

function fakeBuildDependencies() {
  const calls = { cloudflare: [], hosting: 0, sites: 0 };
  return {
    calls,
    dependencies: {
      appRoot,
      existsSync: () => false,
      createVinext() {
        return { name: 'vinext' };
      },
      async loadCloudflare() {
        return {
          cloudflare(options) {
            calls.cloudflare.push(options);
            return [{ name: 'cloudflare-fixture' }];
          },
        };
      },
      async loadSites() {
        calls.sites += 1;
        return { sites: () => ({ name: 'openai-sites-fixture' }) };
      },
      async loadHostingConfig() {
        calls.hosting += 1;
        return { d1: 'DB', r2: 'MEDIA' };
      },
    },
  };
}

void test('agent-poc mode does not load Sites or hosting metadata and selects only its Wrangler config', async () => {
  const harness = fakeBuildDependencies();
  const config = await createWebViteConfig('agent-poc', harness.dependencies);

  assert.equal(harness.calls.sites, 0);
  assert.equal(harness.calls.hosting, 0);
  assert.equal(harness.calls.cloudflare.length, 1);
  assert.equal(
    harness.calls.cloudflare[0].configPath,
    path.join(appRoot, 'wrangler.agent-poc.jsonc'),
  );
  assert.deepEqual(
    config.plugins.flat().map((plugin) => plugin.name),
    ['vinext', 'cloudflare-fixture'],
  );
});

void test('agent-poc mode selects an ignored local Wrangler config when the filesystem seam reports it', async () => {
  const harness = fakeBuildDependencies();
  harness.dependencies.existsSync = () => true;
  await createWebViteConfig('agent-poc', harness.dependencies);
  assert.equal(
    harness.calls.cloudflare[0].configPath,
    path.join(appRoot, 'wrangler.agent-poc.local.jsonc'),
  );
});

void test('the Agent-PoC deploy command cannot bypass build and preflight', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(appRoot, 'package.json'), 'utf8'),
  );

  assert.equal(
    packageJson.scripts['build:agent-poc'],
    'vinext build --mode agent-poc',
  );
  assert.equal(
    packageJson.scripts['preflight:agent-poc'],
    'node --experimental-strip-types scripts/agent-poc-deployment-preflight.ts --config wrangler.agent-poc.local.jsonc --built-config dist/server/wrangler.json --secret-list .wrangler/agent-poc-secret-names.json',
  );
  assert.equal(
    packageJson.scripts['deploy:agent-poc'],
    'npm run build:agent-poc && npm run preflight:agent-poc && wrangler deploy --config dist/server/wrangler.json --strict',
  );
});

void test('the default build retains the existing Sites plugin and local binding projection', async () => {
  const harness = fakeBuildDependencies();
  const config = await createWebViteConfig('production', harness.dependencies);

  assert.equal(harness.calls.sites, 1);
  assert.equal(harness.calls.hosting, 1);
  assert.equal(harness.calls.cloudflare.length, 1);
  assert.deepEqual(
    config.plugins.flat().map((plugin) => plugin.name),
    ['vinext', 'openai-sites-fixture', 'cloudflare-fixture'],
  );
  assert.equal(harness.calls.cloudflare[0].configPath, undefined);
  assert.equal(
    harness.calls.cloudflare[0].config.d1_databases[0].database_name,
    'site-creator-d1',
  );
});

void test('deployment preflight rejects placeholders, missing secrets, and non-isolated build output', async () => {
  const template = JSON.parse(
    (
      await readFile(path.join(appRoot, 'wrangler.agent-poc.jsonc'), 'utf8')
    ).replace(/,\s*([}\]])/gu, '$1'),
  );
  const requiredSecrets = [
    { name: 'AGENT_JPMAP_KEY_ID', type: 'secret_text' },
    { name: 'AGENT_JPMAP_HMAC_SECRET', type: 'secret_text' },
    { name: 'AGENT_OWNER_ACTOR_ID', type: 'secret_text' },
    { name: 'AGENT_OWNER_CONVERSATION_ID', type: 'secret_text' },
    { name: 'GOOGLE_MAPS_API_KEY', type: 'secret_text' },
  ];

  assert.deepEqual(
    inspectAgentPocDeployment({
      sourceConfig: template,
      builtConfig: template,
      remoteSecrets: requiredSecrets,
    }),
    {
      ready: false,
      blockers: ['d1_database_id_placeholder'],
    },
  );

  const configured = structuredClone(template);
  configured.d1_databases[0].database_id =
    '11111111-2222-4333-8444-555555555555';
  assert.deepEqual(
    inspectAgentPocDeployment({
      sourceConfig: configured,
      builtConfig: configured,
      remoteSecrets: requiredSecrets.slice(0, 2),
    }),
    {
      ready: false,
      blockers: [
        'missing_secret:AGENT_OWNER_ACTOR_ID',
        'missing_secret:AGENT_OWNER_CONVERSATION_ID',
        'missing_secret:GOOGLE_MAPS_API_KEY',
      ],
    },
  );

  assert.deepEqual(
    inspectAgentPocDeployment({
      sourceConfig: configured,
      builtConfig: {
        ...configured,
        name: 'site-creator-production',
      },
      remoteSecrets: requiredSecrets,
    }),
    {
      ready: false,
      blockers: ['built_worker_not_isolated'],
    },
  );
});

void test('deployment preflight accepts only matching readonly fixture artifacts and secret names', async () => {
  const template = JSON.parse(
    (
      await readFile(path.join(appRoot, 'wrangler.agent-poc.jsonc'), 'utf8')
    ).replace(/,\s*([}\]])/gu, '$1'),
  );
  template.d1_databases[0].database_id = '11111111-2222-4333-8444-555555555555';

  assert.deepEqual(
    inspectAgentPocDeployment({
      sourceConfig: template,
      builtConfig: structuredClone(template),
      remoteSecrets: [
        { name: 'AGENT_JPMAP_KEY_ID', type: 'secret_text' },
        { name: 'AGENT_JPMAP_HMAC_SECRET', type: 'secret_text' },
        { name: 'AGENT_OWNER_ACTOR_ID', type: 'secret_text' },
        { name: 'AGENT_OWNER_CONVERSATION_ID', type: 'secret_text' },
        { name: 'GOOGLE_MAPS_API_KEY', type: 'secret_text' },
      ],
    }),
    { ready: true, blockers: [] },
  );
});
