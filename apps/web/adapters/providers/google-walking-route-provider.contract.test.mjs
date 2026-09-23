import assert from 'node:assert/strict';
import test from 'node:test';

import { GOOGLE_ROUTES_CREDENTIAL_SCOPE } from './google-provider-contract.ts';
import { createGoogleWalkingRouteProvider } from './google-walking-route-provider.ts';

test('Google walking routes use request-only POST fields and expose no geometry', async () => {
  const requests = [];
  const provider = createGoogleWalkingRouteProvider({
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
              routeDurationSeconds: 840,
              routeDistanceMeters: 950,
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
    estimatedCostUsd: 0.005,
    clock: () => new Date('2026-09-13T12:00:00.000Z'),
  });

  const result = await provider.walking(
    { latitude: 35.6717, longitude: 139.765 },
    { latitude: 35.6762, longitude: 139.77 },
  );

  assert.deepEqual(result, {
    status: 'fresh',
    durationSeconds: 840,
    distanceMeters: 950,
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
            latLng: { latitude: 35.6762, longitude: 139.77 },
          },
        },
        travelMode: 'WALK',
        languageCode: 'ja',
        units: 'METRIC',
      },
      fields: [
        { name: 'routeDurationSeconds', use: 'chat' },
        { name: 'routeDistanceMeters', use: 'chat' },
      ],
      cache: { mode: 'request_only' },
      estimatedCostUsd: 0.005,
    },
  ]);
  assert.equal('geometry' in result, false);
  assert.equal('encodedPolyline' in result, false);
});
