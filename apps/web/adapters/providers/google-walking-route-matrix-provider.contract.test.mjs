import assert from 'node:assert/strict';
import test from 'node:test';

import { GOOGLE_ROUTES_CREDENTIAL_SCOPE } from './google-provider-contract.ts';
import { createGoogleWalkingRouteMatrixProvider } from './google-walking-route-matrix-provider.ts';

test('Google walking RouteProvider batches concurrent destinations into one Compute Route Matrix request', async () => {
  const requests = [];
  const provider = createGoogleWalkingRouteMatrixProvider({
    gateway: {
      async invoke(request) {
        requests.push(request);
        return {
          ok: true,
          value: {
            providerId: 'google-maps-platform',
            policyVersion: 'google-fixture-v1',
            sourceUrl:
              'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
            fields: {
              routeDurationSeconds: [600, 840, 901],
              routeDistanceMeters: [650, 950, 1200],
            },
            attribution,
            cache: { mode: 'request_only' },
          },
        };
      },
    },
    maximumDestinationsPerBatch: 3,
    estimatedCostUsdPerElement: 0.005,
    clock: () => new Date('2026-09-15T12:00:00.000Z'),
  });
  const origin = { latitude: 35.6717, longitude: 139.765 };
  const destinations = [
    { latitude: 35.672, longitude: 139.766 },
    { latitude: 35.673, longitude: 139.767 },
    { latitude: 35.674, longitude: 139.768 },
  ];

  const results = await Promise.all(
    destinations.map((destination) => provider.walking(origin, destination)),
  );

  assert.deepEqual(
    results.map((result) =>
      result.status === 'fresh'
        ? [result.durationSeconds, result.distanceMeters]
        : result.status,
    ),
    [
      [600, 650],
      [840, 950],
      [901, 1200],
    ],
  );
  assert.deepEqual(requests, [
    {
      providerId: 'google-maps-platform',
      credentialScope: GOOGLE_ROUTES_CREDENTIAL_SCOPE,
      method: 'POST',
      url: 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix?fields=originIndex%2CdestinationIndex%2Cstatus%2Ccondition%2CdistanceMeters%2Cduration',
      body: {
        origins: [{ waypoint: { location: { latLng: origin } } }],
        destinations: destinations.map((destination) => ({
          waypoint: { location: { latLng: destination } },
        })),
        travelMode: 'WALK',
        languageCode: 'ja',
        regionCode: 'JP',
        units: 'METRIC',
      },
      fields: [
        { name: 'routeDurationSeconds', use: 'chat' },
        { name: 'routeDistanceMeters', use: 'chat' },
      ],
      cache: { mode: 'request_only' },
      estimatedCostUsd: 0.015,
    },
  ]);
});

const attribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation/routes',
};
