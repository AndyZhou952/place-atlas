import assert from 'node:assert/strict';
import test from 'node:test';

import { createRouteSidecarNearbyAdapter } from './route-sidecar-nearby-adapter.ts';

void test('walking matrix batches 51 destinations into three bounded calls and preserves position', async () => {
  const batchSizes = [];
  const adapter = createRouteSidecarNearbyAdapter({
    async geocode() {
      throw new Error('not used');
    },
    async walkingMatrix(request) {
      batchSizes.push(request.destinations.length);
      if (batchSizes.length === 2)
        return { ok: false, error: { kind: 'provider_failure' } };
      return {
        ok: true,
        evidence: {
          routes: request.destinations.map((_, destinationIndex) => ({
            destinationIndex,
            durationSeconds: 300 + destinationIndex,
            distanceMeters: 500 + destinationIndex,
          })),
          checkedAt: '2026-09-21T00:00:01.000Z',
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
        },
      };
    },
  });
  const destinations = Array.from({ length: 51 }, (_, index) => ({
    latitude: 35 + index / 1000,
    longitude: 139,
  }));
  const routes = await adapter.routeProvider.walkingMany(
    { latitude: 35, longitude: 139 },
    destinations,
  );
  assert.deepEqual(batchSizes, [25, 25, 1]);
  assert.equal(routes.length, 51);
  assert.equal(routes[24].durationSeconds, 324);
  assert.equal(routes[25].status, 'unavailable');
  assert.equal(routes[49].status, 'unavailable');
  assert.equal(routes[50].durationSeconds, 300);
});

void test('RouteEvidencePort maps closed Sidecar evidence into nearby location and walking contracts', async () => {
  const calls = [];
  const adapter = createRouteSidecarNearbyAdapter({
    async geocode(request) {
      calls.push(['geocode', request]);
      return {
        ok: true,
        evidence: {
          candidates: [
            {
              formattedAddress: '東京都中央区銀座',
              point: { latitude: 35.671, longitude: 139.765 },
            },
          ],
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
          source: {
            providerId: 'google-maps-platform',
            endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
          },
          checkedAt: '2026-09-21T00:00:00.000Z',
        },
      };
    },
    async walkingMatrix(request) {
      calls.push(['walkingMatrix', request]);
      return {
        ok: true,
        evidence: {
          routes: [
            {
              destinationIndex: 0,
              durationSeconds: 420,
              distanceMeters: 550,
            },
          ],
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
          source: {
            providerId: 'google-maps-platform',
            endpoint:
              'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
          },
          checkedAt: '2026-09-21T00:00:01.000Z',
        },
      };
    },
  });

  const resolution = await adapter.locationResolver.resolve('銀座');
  assert.deepEqual(resolution, {
    status: 'resolved',
    location: {
      canonicalAddress: '東京都中央区銀座',
      point: { latitude: 35.671, longitude: 139.765 },
    },
    attribution: {
      label: 'Google Maps',
      url: 'https://www.google.com/maps',
    },
    provenance: {
      providerId: 'google-maps-platform',
      policyVersion: 'google-route-sidecar-v1',
      sourceUrl: 'https://maps.googleapis.com/maps/api/geocode/json',
      checkedAt: '2026-09-21T00:00:00.000Z',
    },
  });

  const route = await adapter.routeProvider.walking(
    { latitude: 35.671, longitude: 139.765 },
    { latitude: 35.672, longitude: 139.766 },
  );
  assert.deepEqual(route, {
    status: 'fresh',
    durationSeconds: 420,
    distanceMeters: 550,
    checkedAt: '2026-09-21T00:00:01.000Z',
    attribution: {
      label: 'Google Maps',
      url: 'https://www.google.com/maps',
    },
  });
  assert.deepEqual(calls, [
    ['geocode', { locationHint: '銀座' }],
    [
      'walkingMatrix',
      {
        origin: { latitude: 35.671, longitude: 139.765 },
        destinations: [{ latitude: 35.672, longitude: 139.766 }],
      },
    ],
  ]);
});

void test('RouteEvidencePort preserves multilingual hints, projects ambiguity, and strips Sidecar poison', async () => {
  const hints = [];
  const adapter = createRouteSidecarNearbyAdapter({
    async geocode({ locationHint }) {
      hints.push(locationHint);
      return {
        ok: true,
        evidence: {
          candidates: [
            {
              formattedAddress: '東京都中央区銀座',
              point: { latitude: 35.671, longitude: 139.765 },
              rawGoogleBody: 'SIDE-CAR-RAW-POISON',
            },
            {
              formattedAddress: '銀座駅',
              point: { latitude: 35.672, longitude: 139.766 },
              rawGoogleBody: 'SIDE-CAR-RAW-POISON',
            },
          ],
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
          source: {
            providerId: 'google-maps-platform',
            endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
            rawGoogleBody: 'SIDE-CAR-RAW-POISON',
          },
          checkedAt: '2026-09-21T00:00:00.000Z',
          rawGoogleBody: 'SIDE-CAR-RAW-POISON',
        },
      };
    },
    async walkingMatrix() {
      throw new Error('not used');
    },
  });

  for (const hint of ['银座', '銀座', 'ginza']) {
    const result = await adapter.locationResolver.resolve(hint);
    assert.equal(result.status, 'ambiguous');
    assert.deepEqual(
      result.candidates.map(({ canonicalAddress }) => canonicalAddress),
      ['東京都中央区銀座', '銀座駅'],
    );
    assert.doesNotMatch(JSON.stringify(result), /SIDE-CAR-RAW-POISON/u);
  }
  assert.deepEqual(hints, ['银座', '銀座', 'ginza']);
});

void test('RouteEvidencePort closes empty, typed-failure, thrown-failure, and null-route outcomes', async () => {
  const baseEvidence = {
    candidates: [],
    attribution: { label: 'Google Maps', url: 'https://www.google.com/maps' },
    source: {
      providerId: 'google-maps-platform',
      endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
    },
    checkedAt: '2026-09-21T00:00:00.000Z',
  };
  const empty = createRouteSidecarNearbyAdapter({
    async geocode() {
      return { ok: true, evidence: baseEvidence };
    },
    async walkingMatrix() {
      return {
        ok: true,
        evidence: {
          routes: [
            {
              destinationIndex: 0,
              durationSeconds: null,
              distanceMeters: null,
            },
          ],
          attribution: baseEvidence.attribution,
          source: baseEvidence.source,
          checkedAt: baseEvidence.checkedAt,
          rawGoogleBody: 'SIDE-CAR-RAW-POISON',
        },
      };
    },
  });
  assert.equal(
    (await empty.locationResolver.resolve('銀座')).reason,
    'not_found',
  );
  const nullRoute = await empty.routeProvider.walking(
    { latitude: 35.671, longitude: 139.765 },
    { latitude: 35.672, longitude: 139.766 },
  );
  assert.deepEqual(nullRoute, {
    status: 'unavailable',
    warning: 'Walking route is unavailable.',
  });
  assert.doesNotMatch(JSON.stringify(nullRoute), /SIDE-CAR-RAW-POISON/u);

  const typedFailure = createRouteSidecarNearbyAdapter({
    async geocode() {
      return { ok: false, error: 'quota_exceeded' };
    },
    async walkingMatrix() {
      return { ok: false, error: 'dependency_failure' };
    },
  });
  assert.equal(
    (await typedFailure.locationResolver.resolve('銀座')).reason,
    'dependency_failure',
  );
  assert.equal(
    (
      await typedFailure.routeProvider.walking(
        { latitude: 35.671, longitude: 139.765 },
        { latitude: 35.672, longitude: 139.766 },
      )
    ).status,
    'unavailable',
  );

  const thrownFailure = createRouteSidecarNearbyAdapter({
    async geocode() {
      throw new Error('SIDE-CAR-RAW-POISON');
    },
    async walkingMatrix() {
      throw new Error('SIDE-CAR-RAW-POISON');
    },
  });
  assert.deepEqual(await thrownFailure.locationResolver.resolve('銀座'), {
    status: 'unresolved',
    reason: 'dependency_failure',
    warning: 'Address lookup is temporarily unavailable.',
  });
  assert.deepEqual(
    await thrownFailure.routeProvider.walking(
      { latitude: 35.671, longitude: 139.765 },
      { latitude: 35.672, longitude: 139.766 },
    ),
    {
      status: 'unavailable',
      warning: 'Walking route is temporarily unavailable.',
    },
  );
});
