import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { createWebViteConfig } from '../vite.config.ts';

const appRoot = path.resolve(import.meta.dirname, '..');

function fakeBuildDependencies(exists = false) {
  const calls = { cloudflare: [] };
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
    },
  };
}

for (const mode of ['owner-poc', 'development', 'production']) {
  void test(`${mode} selects the application Cloudflare template`, async () => {
    const harness = fakeBuildDependencies();
    const config = await createWebViteConfig(mode, harness.dependencies);
    assert.equal(
      harness.calls.cloudflare[0].configPath,
      path.join(appRoot, 'wrangler.owner-poc.jsonc'),
    );
    assert.deepEqual(
      config.plugins.flat().map((plugin) => plugin.name),
      ['vinext', 'cloudflare-fixture'],
    );
  });

  void test(`${mode} gives ignored local configuration precedence`, async () => {
    const harness = fakeBuildDependencies(true);
    await createWebViteConfig(mode, harness.dependencies);
    assert.equal(
      harness.calls.cloudflare[0].configPath,
      path.join(appRoot, 'wrangler.owner-poc.local.jsonc'),
    );
  });
}

void test('application deployment builds and runs its configuration preflight', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(appRoot, 'package.json'), 'utf8'),
  );
  assert.equal(
    packageJson.scripts['build:owner-poc'],
    'vinext build --mode owner-poc',
  );
  assert.match(
    packageJson.scripts['preflight:owner-poc'],
    /scripts\/owner-poc-deployment-preflight\.ts/u,
  );
  assert.doesNotMatch(packageJson.scripts['preflight:owner-poc'], /--seed-/u);
  assert.equal(
    packageJson.scripts['deploy:owner-poc'],
    'npm run build:owner-poc && npm run preflight:owner-poc && wrangler deploy --config dist/server/wrangler.json --strict',
  );
});
