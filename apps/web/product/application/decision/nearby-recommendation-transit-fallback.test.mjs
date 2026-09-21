import assert from 'node:assert/strict';
import test from 'node:test';

import { createNearbyRecommendation } from './nearby-recommendation-operation.ts';

test('Nearby transit fallback accepts 20:00 direct routes, rejects 20:01 and transfers, then ranks at most five stably', async () => {
  const items = [
    item('u-b', 1),
    item('u-a', 2),
    item('u-c', 3),
    item('u-boundary', 4),
    item('v-fast', 5, true),
    item('v-extra', 6, true),
    item('too-slow', 7),
    item('transfer', 8),
    item('unavailable', 9),
    item('throws', 10),
  ];
  const transitCalls = [];
  const nearby = createNearbyRecommendation({
    clock: { now: () => new Date('2026-09-13T12:02:00.000Z') },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    catalog: {
      async list() {
        return items;
      },
      async get() {
        return undefined;
      },
    },
    locationResolver: {
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
    },
    routeProvider: {
      async walking() {
        return freshWalking(901);
      },
    },
    transitRouteProvider: {
      async transit(_origin, destination) {
        const source = items.find(
          (candidate) => candidate.latitude === destination.latitude,
        );
        transitCalls.push(source.id);
        if (source.id === 'throws') throw new Error('secret provider detail');
        if (source.id === 'unavailable') {
          return {
            status: 'unavailable',
            warning: 'Transit route is temporarily unavailable.',
          };
        }
        if (source.id === 'too-slow') return freshTransit(1201);
        if (source.id === 'transfer') {
          return {
            ...freshTransit(1100),
            boardingCount: 2,
            lineIdentities: ['Ginza Line', 'Marunouchi Line'],
            transferCount: 1,
          };
        }
        const durationById = {
          'u-a': 400,
          'u-b': 400,
          'u-c': 800,
          'u-boundary': 1200,
          'v-fast': 100,
          'v-extra': 200,
        };
        return freshTransit(durationById[source.id]);
      },
    },
  });

  const result = await nearby.execute({ locationHint: '銀座' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recommendations, []);
  assert.deepEqual(
    transitCalls,
    items.map(({ id }) => id),
  );
  assert.deepEqual(
    result.value.directTransitCandidates.map(({ itemId }) => itemId),
    ['u-a', 'u-b', 'u-c', 'u-boundary', 'v-fast'],
  );
  assert.equal(result.value.directTransitCandidates.length, 5);
  assert.equal(
    result.value.directTransitCandidates.some(
      ({ itemId }) => itemId === 'too-slow' || itemId === 'transfer',
    ),
    false,
  );
  const boundary = result.value.directTransitCandidates.find(
    ({ itemId }) => itemId === 'u-boundary',
  );
  assert.equal(boundary.route.durationSeconds, 1200);
  assert.deepEqual(boundary.route.lineIdentities, ['Ginza Line']);
});

const attribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation/routes',
};

function freshWalking(durationSeconds) {
  return {
    status: 'fresh',
    durationSeconds,
    distanceMeters: 1500,
    checkedAt: '2026-09-13T12:00:00.000Z',
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
    checkedAt: '2026-09-13T12:00:00.000Z',
    attribution,
  };
}

function item(id, offset, hasVisited = false) {
  return {
    id,
    kind: 'food',
    title: `Place ${id}`,
    area: 'Ginza',
    address: `${id} Ginza`,
    description: '',
    latitude: 35.67 + offset / 10_000,
    longitude: 139.76,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-13T00:00:00.000Z',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-13T00:00:00.000Z',
    },
    personalState: hasVisited ? 'visited' : 'candidate',
    hasVisited,
    tags: [],
    sources: [],
  };
}
