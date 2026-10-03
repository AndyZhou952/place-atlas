import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  catalogIntakeProviderPolicy,
  googlePlacesSecretBindingName,
  inspectCatalogIntakeProviderModes,
  projectOwnerPocCatalogIntakeRuntime,
} from './catalog-intake-provider-mode-manifest.ts';

test('provider modes configure deterministic discovery and geocoding', () => {
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
    }),
    {
      googlePlaces: 'enabled',
      durableGeocoder: 'enabled',
    },
  );
});

test('the shared runtime projection maps only the reviewed catalog-intake bindings', () => {
  assert.deepEqual(
    projectOwnerPocCatalogIntakeRuntime({
      ATLAS_PUBLIC_URL: 'https://atlas.example',
      GOOGLE_PLACES_API_KEY: 'server-secret',
      CATALOG_INTAKE_GOOGLE_PLACES_MODE: 'enabled',
      CATALOG_INTAKE_DURABLE_GEOCODER_MODE: 'enabled',
      AGENT_API_KEY: 'agent-key',
      AGENT_BASE_URL: 'https://model.example/v1',
      AGENT_MODEL: 'model',
      SEARCH_API_KEY: 'search-key',
      RESTAURANT_SOURCE_READER: 'firecrawl',
      FIRECRAWL_API_KEY: 'reader-key',
    }),
    {
      publicUrl: 'https://atlas.example',
      browser: undefined,
      sourceReaderProvider: 'firecrawl',
      firecrawlApiKey: 'reader-key',
      agentSettingsSecret: undefined,
      googlePlacesApiKey: 'server-secret',
      agentApiKey: 'agent-key',
      agentBaseUrl: 'https://model.example/v1',
      agentModel: 'model',
      searchApiKey: 'search-key',
      providerModes: {
        googlePlaces: 'enabled',
        durableGeocoder: 'enabled',
      },
    },
  );
});

test('Web production composition consumes the server runtime projection', async () => {
  const server = await readFile(
    new URL('./server-atlas-application.ts', import.meta.url),
    'utf8',
  );
  assert.match(server, /getOwnerPocCatalogIntakeRuntime\(\)/u);
  assert.match(server, /createOwnerPocComposition/u);
});
