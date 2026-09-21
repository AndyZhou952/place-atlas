import assert from 'node:assert/strict';
import test from 'node:test';

import { createMeteredRouteSidecarClient } from './metered-route-sidecar-client.ts';

const geocodeEvidence = {
  ok: true,
  evidence: {
    candidates: [],
    attribution: {
      label: 'Google Maps',
      url: 'https://www.google.com/maps',
    },
    source: {
      providerId: 'google-maps-platform',
      endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
    },
    checkedAt: '2026-09-21T09:00:00.000Z',
  },
};

test('owner client reserves the geocoding SKU before each RPC and never refunds failures', async () => {
  const events = [];
  let reservations = 0;
  const client = createMeteredRouteSidecarClient({
    service: {
      async geocode() {
        events.push('rpc');
        throw new Error('provider unavailable');
      },
      async walkingMatrix() {
        throw new Error('not used');
      },
    },
    usage: {
      async reserve(input) {
        events.push('reserve');
        reservations += input.units;
        assert.deepEqual(input, {
          providerId: 'google-maps-platform',
          sku: 'geocoding.requests',
          units: 1,
          requests: 1,
          costUsd: 0,
          hardRequestLimit: 8000,
          hardUnitLimit: 8000,
          hardCostLimitUsd: 0,
        });
        return 'reserved';
      },
    },
  });

  assert.deepEqual(await client.geocode({ locationHint: '銀座' }), {
    ok: false,
    error: 'dependency_failure',
  });
  assert.deepEqual(await client.geocode({ locationHint: '銀座' }), {
    ok: false,
    error: 'dependency_failure',
  });
  assert.deepEqual(events, ['reserve', 'rpc', 'reserve', 'rpc']);
  assert.equal(reservations, 2);
});

test('owner client reserves origins times destinations and blocks RPC at the walking cap', async () => {
  const reservations = [];
  let rpcCalls = 0;
  const client = createMeteredRouteSidecarClient({
    service: {
      async geocode() {
        return geocodeEvidence;
      },
      async walkingMatrix(request) {
        rpcCalls += 1;
        return {
          ok: true,
          evidence: {
            routes: request.destinations.map((_, destinationIndex) => ({
              destinationIndex,
              durationSeconds: 60,
              distanceMeters: 100,
            })),
            attribution: geocodeEvidence.evidence.attribution,
            source: {
              providerId: 'google-maps-platform',
              endpoint:
                'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
            },
            checkedAt: '2026-09-21T09:00:00.000Z',
          },
        };
      },
    },
    usage: {
      async reserve(input) {
        reservations.push(input);
        return reservations.length === 1 ? 'reserved' : 'quota_exceeded';
      },
    },
  });
  const request = {
    origin: { latitude: 35.67, longitude: 139.76 },
    destinations: [
      { latitude: 35.671, longitude: 139.761 },
      { latitude: 35.672, longitude: 139.762 },
    ],
  };

  assert.equal((await client.walkingMatrix(request)).ok, true);
  assert.deepEqual(await client.walkingMatrix(request), {
    ok: false,
    error: 'quota_exceeded',
  });
  assert.deepEqual(reservations, [
    {
      providerId: 'google-maps-platform',
      sku: 'walking_matrix.elements',
      units: 2,
      requests: 1,
      costUsd: 0,
      hardRequestLimit: 8000,
      hardUnitLimit: 8000,
      hardCostLimitUsd: 0,
    },
    {
      providerId: 'google-maps-platform',
      sku: 'walking_matrix.elements',
      units: 2,
      requests: 1,
      costUsd: 0,
      hardRequestLimit: 8000,
      hardUnitLimit: 8000,
      hardCostLimitUsd: 0,
    },
  ]);
  assert.equal(rpcCalls, 1);
});

test('owner client fails closed without a service binding and performs no reservation', async () => {
  let reservations = 0;
  const client = createMeteredRouteSidecarClient({
    service: undefined,
    usage: {
      async reserve() {
        reservations += 1;
        return 'reserved';
      },
    },
  });

  assert.deepEqual(await client.geocode({ locationHint: 'ginza' }), {
    ok: false,
    error: 'not_configured',
  });
  assert.deepEqual(
    await client.walkingMatrix({
      origin: { latitude: 35.67, longitude: 139.76 },
      destinations: [{ latitude: 35.671, longitude: 139.761 }],
    }),
    { ok: false, error: 'not_configured' },
  );
  assert.equal(reservations, 0);
});
