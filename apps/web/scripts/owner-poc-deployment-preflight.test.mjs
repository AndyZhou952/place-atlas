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
    CATALOG_INTAKE_GOOGLE_PLACES_MODE: 'enabled',
    CATALOG_INTAKE_DURABLE_GEOCODER_MODE: 'enabled',
    CATALOG_INTAKE_RESEARCH_RELAY_MODE: 'relay_disabled_manual_unknown',
  });
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.observability, {
    enabled: true,
    head_sampling_rate: 0.05,
    redact_query_string: true,
    logs: {
      enabled: true,
      head_sampling_rate: 0.05,
      invocation_logs: false,
    },
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
  assert.deepEqual(config.services, [
    {
      binding: 'ROUTE_SIDECAR',
      service: 'japan-atlas-route-sidecar',
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
    'GOOGLE_PLACES_API_KEY',
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
        'missing_secret:GOOGLE_PLACES_API_KEY',
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
    'GOOGLE_PLACES_API_KEY',
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
        blockers: [
          ...(forbidden.services
            ? ['built_route_sidecar_binding_invalid']
            : []),
          'built_runtime_metadata_forbidden',
        ],
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

void test('owner PoC preflight requires exactly one well-formed private Route Sidecar binding in source and built artifacts', async () => {
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
    'GOOGLE_PLACES_API_KEY',
  ].map((name) => ({ name, type: 'secret_text' }));

  const cases = [
    {
      name: 'source missing',
      sourceServices: [],
      builtServices: template.services,
      blocker: 'source_route_sidecar_binding_invalid',
    },
    {
      name: 'source extra',
      sourceServices: [
        ...template.services,
        { binding: 'OTHER', service: 'other-worker' },
      ],
      builtServices: template.services,
      blocker: 'source_route_sidecar_binding_invalid',
    },
    {
      name: 'built missing',
      sourceServices: template.services,
      builtServices: [],
      blocker: 'built_route_sidecar_binding_invalid',
    },
    {
      name: 'built wrong service',
      sourceServices: template.services,
      builtServices: [
        { binding: 'ROUTE_SIDECAR', service: 'not-the-route-sidecar' },
      ],
      blocker: 'built_route_sidecar_binding_invalid',
    },
    {
      name: 'built malformed extra field',
      sourceServices: template.services,
      builtServices: [
        {
          binding: 'ROUTE_SIDECAR',
          service: 'japan-atlas-route-sidecar',
          entrypoint: 'UnexpectedEntrypoint',
        },
      ],
      blocker: 'built_route_sidecar_binding_invalid',
    },
  ];

  for (const scenario of cases) {
    const sourceConfig = {
      ...structuredClone(template),
      services: scenario.sourceServices,
    };
    const builtConfig = {
      ...structuredClone(template),
      services: scenario.builtServices,
    };
    assert.deepEqual(
      inspectOwnerPocDeployment({
        sourceConfig,
        builtConfig,
        remoteSecrets: secrets,
      }),
      { ready: false, blockers: [scenario.blocker] },
      scenario.name,
    );
  }
});

void test('owner PoC preflight rejects an unexpected encrypted secret name', async () => {
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
    'GOOGLE_PLACES_API_KEY',
    'UNREVIEWED_EXTRA_SECRET',
  ].map((name) => ({ name, type: 'secret_text' }));
  assert.deepEqual(
    inspectOwnerPocDeployment({
      sourceConfig: template,
      builtConfig: structuredClone(template),
      remoteSecrets: secrets,
    }),
    { ready: false, blockers: ['unexpected_secret:UNREVIEWED_EXTRA_SECRET'] },
  );
});
