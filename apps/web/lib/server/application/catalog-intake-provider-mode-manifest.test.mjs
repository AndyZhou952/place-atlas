import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  catalogIntakeProviderPolicy,
  googlePlacesSecretBindingName,
  inspectCatalogIntakeProviderModes,
  projectOwnerPocCatalogIntakeRuntime,
} from './catalog-intake-provider-mode-manifest.ts';

test('owner-poc enables only the reviewed guarded Relay mode', () => {
  assert.equal(googlePlacesSecretBindingName, 'GOOGLE_PLACES_API_KEY');
  assert.deepEqual(catalogIntakeProviderPolicy.googlePlaces.persistedFields, [
    'placeId',
  ]);
  assert.deepEqual(catalogIntakeProviderPolicy.googlePlaces.transientFields, [
    'displayName',
    'formattedAddress',
  ]);
  assert.deepEqual(
    inspectCatalogIntakeProviderModes({
      googlePlaces: 'enabled',
      durableGeocoder: 'enabled',
      researchRelay: 'relay_enabled_guarded_v1',
    }),
    {
      googlePlaces: 'enabled',
      durableGeocoder: 'enabled',
      researchRelay: 'relay_enabled_guarded_v1',
    },
  );
});

test('the shared runtime projection maps only the reviewed catalog-intake bindings', () => {
  assert.deepEqual(
    projectOwnerPocCatalogIntakeRuntime({
      GOOGLE_PLACES_API_KEY: 'server-secret',
      CATALOG_INTAKE_GOOGLE_PLACES_MODE: 'enabled',
      CATALOG_INTAKE_DURABLE_GEOCODER_MODE: 'enabled',
      CATALOG_INTAKE_RESEARCH_RELAY_MODE: 'relay_disabled_manual_unknown',
      RESEARCH_RELAY_ENDPOINT: 'https://research.example/v1/research',
      RESEARCH_RELAY_INGRESS_BEARER_SECRET: 'i'.repeat(32),
      RESEARCH_ALLOWANCE_KEY_VERSION: 'allowance-v1',
      RESEARCH_ALLOWANCE_HMAC_SECRET: 'a'.repeat(32),
      RESEARCH_RESULT_KEY_VERSION: 'result-v1',
      RESEARCH_RESULT_HMAC_SECRET: 'r'.repeat(32),
    }),
    {
      googlePlacesApiKey: 'server-secret',
      researchRelayEndpoint: 'https://research.example/v1/research',
      researchRelayIngressBearerSecret: 'i'.repeat(32),
      researchAllowanceKeyVersion: 'allowance-v1',
      researchAllowanceHmacSecret: 'a'.repeat(32),
      researchResultKeyVersion: 'result-v1',
      researchResultHmacSecret: 'r'.repeat(32),
      providerModes: {
        googlePlaces: 'enabled',
        durableGeocoder: 'enabled',
        researchRelay: 'relay_disabled_manual_unknown',
      },
    },
  );
});

test('Web and Agent production composition consume the same server runtime projection', async () => {
  const [server, agentRoute] = await Promise.all([
    readFile(new URL('./server-atlas-application.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../../../app/api/agent/v1/tools/route.ts', import.meta.url),
      'utf8',
    ),
  ]);
  assert.match(server, /getOwnerPocCatalogIntakeRuntime\(\)/u);
  assert.match(agentRoute, /projectOwnerPocCatalogIntakeRuntime\(bindings\)/u);
  assert.match(server, /createOwnerPocComposition/u);
  assert.match(agentRoute, /createOwnerPocComposition/u);
});
