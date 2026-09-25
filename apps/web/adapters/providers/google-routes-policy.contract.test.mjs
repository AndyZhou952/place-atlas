import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createProviderPolicyGateway } from '../../product/provider-policy/provider-policy-gateway.ts';
import { GOOGLE_ROUTES_CREDENTIAL_SCOPE } from './google-provider-contract.ts';
import { createGoogleTransitRouteProvider } from './google-transit-route-provider.ts';
import { createGoogleWalkingRouteProvider } from './google-walking-route-provider.ts';
import { publicUnicastAddressClassifier as addressClassifier } from './public-unicast-address-classifier.ts';

const policy = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('./policies/catalog/google-2026-09-13.v1.json', import.meta.url),
    ),
    'utf8',
  ),
);

function gatewayFor(body) {
  return createProviderPolicyGateway({
    addressClassifier,
    policies: [{ ...policy, status: 'active' }],
    resolve: async () => ['142.250.207.42'],
    usage: { reserve: async () => 'reserved' },
    transport: async () => ({ status: 200, headers: {}, body }),
  });
}

test('the Google walking adapter is accepted by the versioned Google policy document', async () => {
  assert.ok(policy.credentialScopes.includes(GOOGLE_ROUTES_CREDENTIAL_SCOPE));

  const provider = createGoogleWalkingRouteProvider({
    gateway: gatewayFor({
      routeDurationSeconds: 840,
      routeDistanceMeters: 950,
    }),
    estimatedCostUsd: 0.005,
    clock: () => new Date('2026-09-13T12:00:00.000Z'),
  });

  assert.deepEqual(
    await provider.walking(
      { latitude: 35.6717, longitude: 139.765 },
      { latitude: 35.6762, longitude: 139.77 },
    ),
    {
      status: 'fresh',
      durationSeconds: 840,
      distanceMeters: 950,
      checkedAt: '2026-09-13T12:00:00.000Z',
      attribution: policy.attribution.chat,
    },
  );
});

test('the Google transit adapter is accepted by the versioned Google policy document', async () => {
  assert.ok(policy.credentialScopes.includes(GOOGLE_ROUTES_CREDENTIAL_SCOPE));

  const provider = createGoogleTransitRouteProvider({
    gateway: gatewayFor({
      transitLegs: {
        durationSeconds: 1200,
        boardingCount: 1,
        lineIdentities: ['Tokyo Metro|Ginza Line|G'],
        transferCount: 0,
      },
    }),
    estimatedCostUsd: 0.01,
    clock: () => new Date('2026-09-13T12:00:00.000Z'),
  });

  assert.deepEqual(
    await provider.transit(
      { latitude: 35.6717, longitude: 139.765 },
      { latitude: 35.6895, longitude: 139.6917 },
    ),
    {
      status: 'fresh',
      durationSeconds: 1200,
      boardingCount: 1,
      lineIdentities: ['Tokyo Metro|Ginza Line|G'],
      transferCount: 0,
      checkedAt: '2026-09-13T12:00:00.000Z',
      attribution: policy.attribution.chat,
    },
  );
});
