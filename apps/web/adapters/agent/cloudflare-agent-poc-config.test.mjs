import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createUsageCostMeter } from '../../product/application/cost/usage-cost-meter.ts';

const configUrl = new URL('../../wrangler.agent-poc.jsonc', import.meta.url);
const secretTemplateUrl = new URL(
  '../../.dev.vars.agent-poc.example',
  import.meta.url,
);
const deploymentRootUrl = new URL(
  '../../../../features/004-openclaw-atlas-poc/deployment/cloudflare-poc/',
  import.meta.url,
);

void test('the Agent PoC Wrangler config names an isolated fixture Worker, D1, and R2', async () => {
  const config = parseJsonc(await readFile(configUrl, 'utf8'));

  assert.equal(config.name, 'japan-atlas-agent-poc');
  assert.equal(config.main, 'vinext/server/fetch-handler');
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat']);
  assert.deepEqual(config.vars, {
    ATLAS_DATASET: 'fixture',
    ATLAS_DEPLOYMENT_ENV: 'agent-poc-readonly',
  });
  assert.deepEqual(config.d1_databases, [
    {
      binding: 'DB',
      database_name: 'japan-atlas-agent-poc-fixture',
      database_id: '00000000-0000-4000-8000-000000000000',
    },
  ]);
  assert.deepEqual(config.r2_buckets, [
    {
      binding: 'MEDIA',
      bucket_name: 'japan-atlas-agent-poc-media-fixture',
    },
  ]);

  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /site-creator|appgprj_|secret|sk-/iu);
});

void test('the checked-in secret template contains names and placeholders, never usable values', async () => {
  const template = await readFile(secretTemplateUrl, 'utf8');

  assert.match(template, /^AGENT_JPMAP_KEY_ID=<replace-me>$/mu);
  assert.match(template, /^AGENT_JPMAP_HMAC_SECRET=<replace-me>$/mu);
  assert.match(template, /^AGENT_OWNER_ACTOR_ID=<replace-me>$/mu);
  assert.match(template, /^AGENT_OWNER_CONVERSATION_ID=<replace-me>$/mu);
  assert.match(template, /^GOOGLE_MAPS_API_KEY=<replace-me>$/mu);
  assert.doesNotMatch(template, /sk-[A-Za-z0-9]{8,}|fixture-secret/iu);
});

void test('the isolated fixture schema contains gateway state and fake nearby data only', async () => {
  const schema = await readFile(
    new URL('0001_agent_readonly_fixture.sql', deploymentRootUrl),
    'utf8',
  );

  for (const table of [
    'agent_gateway_nonces',
    'agent_gateway_receipts',
    'agent_gateway_audit',
    'agent_nearby_fixtures',
  ]) {
    assert.match(schema, new RegExp(`CREATE TABLE ${table}`, 'u'));
  }
  assert.doesNotMatch(
    schema,
    /DROP TABLE|DELETE FROM|atlas_items|place_assessments|visits|site-creator/iu,
  );
});

void test('the saved read-gate budget report reproduces the 60 USD hard gate', async () => {
  const saved = JSON.parse(
    await readFile(
      new URL('budget/read-gate-budget.json', deploymentRootUrl),
      'utf8',
    ),
  );
  const report = createUsageCostMeter(saved.policy).project(saved.input);

  assert.deepEqual(report, saved.projection);
  assert.equal(report.hardLimitUsd, 60);
  assert.equal(report.gate, 'open');
  assert.equal(report.calibration, 'provisional');
  assert.deepEqual(saved.blockers, [
    'cloudflare_account_authorization',
    'isolated_d1_database_id',
    'isolated_r2_bucket_creation',
    'cloudflare_bill_and_usage_calibration',
  ]);
});

void test('the runbook stops before deploy until account resources and secrets are supplied', async () => {
  const runbook = await readFile(
    new URL('README.md', deploymentRootUrl),
    'utf8',
  );

  assert.match(runbook, /japan-atlas-agent-poc-fixture/u);
  assert.match(runbook, /japan-atlas-agent-poc-media-fixture/u);
  assert.match(runbook, /wrangler secret put AGENT_JPMAP_HMAC_SECRET/u);
  assert.match(runbook, /wrangler\.agent-poc\.local\.jsonc/u);
  assert.match(runbook, /STOP.*Cloudflare/u);
  assert.doesNotMatch(runbook, /sk-[A-Za-z0-9]{8,}/u);
});

function parseJsonc(source) {
  return JSON.parse(source.replace(/,\s*([}\]])/gu, '$1'));
}
