import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { inspectOwnerPocDeployment } from './owner-poc-deployment-preflight.ts';

const configUrl = new URL('../wrangler.owner-poc.jsonc', import.meta.url);

void test('the owner PoC template selects only blue-green D1 and R2 resources', async () => {
  const source = await readFile(configUrl, 'utf8');
  const config = JSON.parse(source.replace(/,\s*([}\]])/gu, '$1'));

  assert.equal(config.name, 'japan-atlas-owner-poc');
  assert.deepEqual(config.vars, {
    ATLAS_DATASET: 'owner-poc',
    ATLAS_DEPLOYMENT_ENV: 'owner-poc',
  });
  assert.deepEqual(config.d1_databases, [
    {
      binding: 'DB',
      database_name: 'japan-atlas-owner-poc',
      database_id: '00000000-0000-4000-8000-000000000000',
      migrations_dir:
        '../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc',
    },
  ]);
  assert.deepEqual(config.r2_buckets, [
    {
      binding: 'MEDIA',
      bucket_name: 'japan-atlas-owner-poc-media',
    },
  ]);
  assert.doesNotMatch(
    source,
    /foursquare|site-creator|appgprj_|openai.*sites|secret|sk-/iu,
  );
});

void test('owner PoC preflight accepts only a matching blue-green artifact with every required secret name', async () => {
  const template = JSON.parse(
    (await readFile(configUrl, 'utf8')).replace(/,\s*([}\]])/gu, '$1'),
  );
  template.d1_databases[0].database_id = '11111111-2222-4333-8444-555555555555';
  const secrets = [
    'AGENT_JPMAP_KEY_ID',
    'AGENT_JPMAP_HMAC_SECRET',
    'AGENT_OWNER_ACTOR_ID',
    'AGENT_OWNER_CONVERSATION_ID',
    'ATLAS_OWNER_PASSWORD',
    'ATLAS_OWNER_SESSION_SECRET',
  ].map((name) => ({ name, type: 'secret_text' }));

  assert.deepEqual(
    inspectOwnerPocDeployment({
      sourceConfig: template,
      builtConfig: structuredClone(template),
      remoteSecrets: secrets,
    }),
    { ready: true, blockers: [] },
  );
});

void test('owner PoC preflight rejects placeholders, missing owner secrets, and forbidden runtime metadata', async () => {
  const template = JSON.parse(
    (await readFile(configUrl, 'utf8')).replace(/,\s*([}\]])/gu, '$1'),
  );
  const built = structuredClone(template);
  built.foursquare = { binding: 'PLACES' };

  assert.deepEqual(
    inspectOwnerPocDeployment({
      sourceConfig: template,
      builtConfig: built,
      remoteSecrets: [
        { name: 'AGENT_JPMAP_KEY_ID', type: 'secret_text' },
        { name: 'AGENT_JPMAP_HMAC_SECRET', type: 'secret_text' },
        { name: 'AGENT_OWNER_ACTOR_ID', type: 'secret_text' },
        { name: 'AGENT_OWNER_CONVERSATION_ID', type: 'secret_text' },
      ],
    }),
    {
      ready: false,
      blockers: [
        'd1_database_id_placeholder',
        'built_runtime_metadata_forbidden',
        'missing_secret:ATLAS_OWNER_PASSWORD',
        'missing_secret:ATLAS_OWNER_SESSION_SECRET',
      ],
    },
  );
});

void test('owner PoC rejects direct Google, Transit, or Foursquare runtime capabilities', async () => {
  const template = JSON.parse(
    (await readFile(configUrl, 'utf8')).replace(/,\s*([}\]])/gu, '$1'),
  );
  template.d1_databases[0].database_id = '11111111-2222-4333-8444-555555555555';
  const secrets = [
    'AGENT_JPMAP_KEY_ID',
    'AGENT_JPMAP_HMAC_SECRET',
    'AGENT_OWNER_ACTOR_ID',
    'AGENT_OWNER_CONVERSATION_ID',
    'ATLAS_OWNER_PASSWORD',
    'ATLAS_OWNER_SESSION_SECRET',
  ].map((name) => ({ name, type: 'secret_text' }));

  for (const forbidden of [
    { vars: { ...template.vars, GOOGLE_MAPS_API_KEY: 'bound' } },
    { services: [{ binding: 'TRANSIT', service: 'transit-routes' }] },
    { vars: { ...template.vars, FOURSQUARE_API_KEY: 'bound' } },
  ]) {
    assert.deepEqual(
      inspectOwnerPocDeployment({
        sourceConfig: template,
        builtConfig: { ...structuredClone(template), ...forbidden },
        remoteSecrets: secrets,
      }),
      {
        ready: false,
        blockers: ['built_runtime_metadata_forbidden'],
      },
    );
  }

  assert.deepEqual(
    inspectOwnerPocDeployment({
      sourceConfig: template,
      builtConfig: structuredClone(template),
      remoteSecrets: [
        ...secrets,
        { name: 'GOOGLE_MAPS_API_KEY', type: 'secret_text' },
      ],
    }),
    {
      ready: false,
      blockers: ['forbidden_secret:GOOGLE_MAPS_API_KEY'],
    },
  );
});
