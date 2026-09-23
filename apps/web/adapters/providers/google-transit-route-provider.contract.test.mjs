import assert from 'node:assert/strict';
import test from 'node:test';

import { GOOGLE_ROUTES_CREDENTIAL_SCOPE } from './google-provider-contract.ts';
import { createGoogleTransitRouteProvider } from './google-transit-route-provider.ts';

test('Google transit routes request only normalized legs and expose computed facts with attribution', async () => {
  const requests = [];
  const provider = createGoogleTransitRouteProvider({
    gateway: {
      async invoke(request) {
        requests.push(request);
        return {
          ok: true,
          value: {
            providerId: 'google-maps-platform',
            policyVersion: 'google-fixture-v1',
            sourceUrl:
              'https://routes.googleapis.com/directions/v2:computeRoutes',
            fields: {
              transitLegs: {
                durationSeconds: 1200,
                boardingCount: 1,
                lineIdentities: ['Tokyo Metro|Ginza Line|G'],
                transferCount: 0,
              },
              encodedPolyline: 'must-not-be-exposed',
            },
            attribution: {
              label: 'Google Maps',
              url: 'https://developers.google.com/maps/documentation/routes',
            },
            cache: { mode: 'request_only' },
          },
        };
      },
    },
    estimatedCostUsd: 0.01,
    clock: () => new Date('2026-09-13T12:00:00.000Z'),
  });

  const result = await provider.transit(
    { latitude: 35.6717, longitude: 139.765 },
    { latitude: 35.6895, longitude: 139.6917 },
  );

  assert.deepEqual(result, {
    status: 'fresh',
    durationSeconds: 1200,
    boardingCount: 1,
    lineIdentities: ['Tokyo Metro|Ginza Line|G'],
    transferCount: 0,
    checkedAt: '2026-09-13T12:00:00.000Z',
    attribution: {
      label: 'Google Maps',
      url: 'https://developers.google.com/maps/documentation/routes',
    },
  });
  assert.deepEqual(requests, [
    {
      providerId: 'google-maps-platform',
      credentialScope: GOOGLE_ROUTES_CREDENTIAL_SCOPE,
      method: 'POST',
      url: 'https://routes.googleapis.com/directions/v2:computeRoutes',
      body: {
        origin: {
          location: {
            latLng: { latitude: 35.6717, longitude: 139.765 },
          },
        },
        destination: {
          location: {
            latLng: { latitude: 35.6895, longitude: 139.6917 },
          },
        },
        travelMode: 'TRANSIT',
        languageCode: 'ja',
        units: 'METRIC',
      },
      fields: [{ name: 'transitLegs', use: 'chat' }],
      cache: { mode: 'request_only' },
      estimatedCostUsd: 0.01,
    },
  ]);
  assert.equal('geometry' in result, false);
  assert.equal('encodedPolyline' in result, false);
});

test('Google transit route failures and malformed normalized legs fail closed', async () => {
  for (const invoke of [
    async () => {
      throw new Error('secret');
    },
    async () => ({
      ok: true,
      value: {
        fields: {
          transitLegs: {
            durationSeconds: 1200,
            boardingCount: 1,
            lineIdentities: [],
            transferCount: 0,
          },
        },
        attribution: {
          label: 'Google Maps',
          url: 'https://developers.google.com/maps/documentation/routes',
        },
      },
    }),
  ]) {
    const provider = createGoogleTransitRouteProvider({
      gateway: { invoke },
      estimatedCostUsd: 0.01,
      clock: () => new Date('2026-09-13T12:00:00.000Z'),
    });

    assert.deepEqual(
      await provider.transit(
        { latitude: 35.6717, longitude: 139.765 },
        { latitude: 35.6895, longitude: 139.6917 },
      ),
      {
        status: 'unavailable',
        warning: 'Transit route is temporarily unavailable.',
      },
    );
  }
});
