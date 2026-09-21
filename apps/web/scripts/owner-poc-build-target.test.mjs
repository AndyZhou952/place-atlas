import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createWebViteConfig } from '../vite.config.ts';

const appRoot = path.resolve(import.meta.dirname, '..');
const ownerRunbookUrl = new URL(
  '../../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/README.md',
  import.meta.url,
);

function fakeBuildDependencies(exists = false) {
  const calls = { cloudflare: [], hosting: 0, sites: 0 };
  return {
    calls,
    dependencies: {
      appRoot,
      existsSync: () => exists,
      createVinext: () => ({ name: 'vinext' }),
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

void test('owner-poc mode bypasses Sites and selects the committed template', async () => {
  const harness = fakeBuildDependencies();
  const config = await createWebViteConfig('owner-poc', harness.dependencies);

  assert.equal(harness.calls.sites, 0);
  assert.equal(harness.calls.hosting, 0);
  assert.equal(
    harness.calls.cloudflare[0].configPath,
    path.join(appRoot, 'wrangler.owner-poc.jsonc'),
  );
  assert.deepEqual(
    config.plugins.flat().map((plugin) => plugin.name),
    ['vinext', 'cloudflare-fixture'],
  );
});

void test('owner-poc mode gives an ignored local config precedence', async () => {
  const harness = fakeBuildDependencies(true);
  await createWebViteConfig('owner-poc', harness.dependencies);
  assert.equal(
    harness.calls.cloudflare[0].configPath,
    path.join(appRoot, 'wrangler.owner-poc.local.jsonc'),
  );
});

void test('owner-poc deploy cannot bypass its build and preflight', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(appRoot, 'package.json'), 'utf8'),
  );
  assert.equal(
    packageJson.scripts['build:owner-poc'],
    'vinext build --mode owner-poc',
  );
  assert.equal(
    packageJson.scripts['preflight:owner-poc'],
    'node --experimental-strip-types scripts/owner-poc-deployment-preflight.ts --config wrangler.owner-poc.local.jsonc --built-config dist/server/wrangler.json --secret-list .wrangler/owner-poc-secret-names.json --seed-manifest ../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/owner-poc-seed-v1.json --seed-evidence .wrangler/owner-poc-seed-evidence.json',
  );
  assert.equal(
    packageJson.scripts['deploy:owner-poc'],
    'npm run build:owner-poc && npm run preflight:owner-poc && wrangler deploy --config dist/server/wrangler.json --strict',
  );
});

void test('owner-poc runbook captures fresh target-D1 evidence immediately before preflight', async () => {
  const runbook = await readFile(ownerRunbookUrl, 'utf8');
  const gatedDeployment = [
    'npm run build:owner-poc',
    'npx wrangler d1 execute japan-atlas-owner-poc --remote --config wrangler.owner-poc.local.jsonc --file scripts/owner-poc-seed-evidence.sql --json > .wrangler/owner-poc-seed-rows.json',
    'node --experimental-strip-types scripts/owner-poc-seed-evidence-envelope.ts --config wrangler.owner-poc.local.jsonc --rows .wrangler/owner-poc-seed-rows.json > .wrangler/owner-poc-seed-evidence.json',
    'npm run preflight:owner-poc',
    'npx wrangler deploy --config dist/server/wrangler.json --strict',
  ].join('\n');
  const fence = String.fromCharCode(96).repeat(3);

  assert.ok(
    runbook.includes(fence + 'text\n' + gatedDeployment + '\n' + fence),
    'build, canonical query, evidence envelope, preflight, and deploy must stay adjacent',
  );
  assert.doesNotMatch(
    runbook,
    /owner-poc-seed-evidence\.sql[^\n]+> \.wrangler\/owner-poc-seed-evidence\.json/u,
  );
  assert.ok(
    runbook.indexOf('wrangler secret list') < runbook.indexOf(gatedDeployment),
    'secret setup must happen before the fresh evidence gate',
  );
});
