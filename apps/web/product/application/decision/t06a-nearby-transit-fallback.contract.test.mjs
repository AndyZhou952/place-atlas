import assert from 'node:assert/strict';
import test from 'node:test';

import { createT06aNearbyRecommendation } from './t06a-nearby-recommendation.ts';

test('T-06A requests only the nearest small transit shortlist after the walking layer is empty', async () => {
  const transitCalls = [];
  const items = [
    item('near-a', 0.001),
    item('near-b', 0.002),
    item('far-c', 0.003),
  ];
  const nearby = createT06aNearbyRecommendation({
    shortlistLimit: 3,
    transitShortlistLimit: 2,
    clock: { now: () => new Date('2026-09-15T12:02:00.000Z') },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    catalog: catalogWith(items),
    locationResolver: resolvedOrigin(),
    routeProvider: {
      async walking() {
        return freshWalking(901);
      },
    },
    transitRouteProvider: {
      async transit(_origin, destination) {
        const candidate = items.find(
          (value) => value.latitude === destination.latitude,
        );
        transitCalls.push(candidate.id);
        return freshTransit(600);
      },
    },
  });

  const result = await nearby.execute({ locationHint: '銀座' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recommendations, []);
  assert.deepEqual(transitCalls, ['near-a', 'near-b']);
  assert.deepEqual(
    result.value.directTransitCandidates.map(({ itemId }) => itemId),
    ['near-a', 'near-b'],
  );
});

const attribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation/routes',
};

function resolvedOrigin() {
  return {
    async resolve() {
      return {
        status: 'resolved',
        location: {
          canonicalAddress: '東京都中央区銀座',
          point: { latitude: 35.67, longitude: 139.76 },
        },
        attribution,
        provenance: {
          providerId: 'google-maps-platform',
          policyVersion: 'fixture-v1',
          sourceUrl: 'https://maps.googleapis.com/maps/api/geocode/json',
          checkedAt: '2026-09-15T12:00:00.000Z',
        },
      };
    },
  };
}

function freshWalking(durationSeconds) {
  return {
    status: 'fresh',
    durationSeconds,
    distanceMeters: 1200,
    checkedAt: '2026-09-15T12:00:00.000Z',
    attribution,
  };
}

function freshTransit(durationSeconds) {
  return {
    status: 'fresh',
    durationSeconds,
    boardingCount: 1,
    lineIdentities: ['Ginza Line'],
    transferCount: 0,
    checkedAt: '2026-09-15T12:00:00.000Z',
    attribution,
  };
}

function catalogWith(items) {
  return {
    async list() {
      return items;
    },
    async get() {
      return undefined;
    },
  };
}

function item(id, latitudeOffset) {
  return {
    id,
    kind: 'food',
    title: id,
    area: 'Ginza',
    address: `${id} Ginza`,
    description: '',
    latitude: 35.67 + latitudeOffset,
    longitude: 139.76,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-13T00:00:00.000Z',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-13T00:00:00.000Z',
    },
    personalState: 'candidate',
    hasVisited: false,
    tags: [],
    sources: [],
  };
}
