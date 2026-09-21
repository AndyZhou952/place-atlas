import assert from 'node:assert/strict';
import test from 'node:test';

import { createNearbyRecommendation } from './nearby-recommendation-operation.ts';

test('Nearby never invokes distance or transit fallback while a walking result exists', async () => {
  let transitCalls = 0;
  const nearby = createNearbyRecommendation({
    clock: { now: () => new Date('2026-09-13T12:02:00.000Z') },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    catalog: catalogWith([item('walkable', 0.001)]),
    locationResolver: resolvedOrigin(),
    routeProvider: {
      async walking() {
        return freshWalking(900);
      },
    },
    transitRouteProvider: {
      async transit() {
        transitCalls += 1;
        throw new Error('fallback must not run');
      },
    },
  });

  const result = await nearby.execute({ locationHint: '銀座' });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.value.recommendations.map(({ itemId }) => itemId),
    ['walkable'],
  );
  assert.deepEqual(result.value.distanceCandidates, []);
  assert.deepEqual(result.value.directTransitCandidates, []);
  assert.equal(transitCalls, 0);
});

const attribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation',
};

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
      };
    },
  };
}

function freshWalking(durationSeconds) {
  return {
    status: 'fresh',
    durationSeconds,
    distanceMeters: 700,
    checkedAt: '2026-09-13T12:00:00.000Z',
    attribution,
  };
}

function item(id, offset) {
  return {
    id,
    kind: 'food',
    title: `Place ${id}`,
    area: 'Ginza',
    address: `${id} Ginza`,
    description: '',
    latitude: 35.67 + offset,
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
