import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  catalogIntakeProviderPolicy,
  googlePlacesSecretBindingName,
  inspectCatalogIntakeProviderModes,
} from './catalog-intake-provider-mode-manifest.ts';

test('owner-poc has a closed provider policy and Relay cannot be enabled while D-P06 is Proposed', () => {
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
      researchRelay: 'relay_enabled',
    }),
    {
      googlePlaces: 'enabled',
      durableGeocoder: 'enabled',
      researchRelay: 'relay_disabled_manual_unknown',
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
  assert.match(agentRoute, /getOwnerPocCatalogIntakeRuntime\(\)/u);
  assert.match(server, /createOwnerPocComposition/u);
  assert.match(agentRoute, /createOwnerPocComposition/u);
});
