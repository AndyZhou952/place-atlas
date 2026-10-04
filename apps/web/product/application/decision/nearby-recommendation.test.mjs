import assert from 'node:assert/strict';
import test from 'node:test';

import { createNearbyRecommendation } from './nearby-recommendation-operation.ts';

test('Nearby uses verified food, live walking routes, a 15-minute hard filter, and stable unvisited-first ranking', async () => {
  const profiles = [];
  const routeCalls = [];
  const items = [
    item('u-b', 2, { durationSeconds: 400 }),
    item('u-a', 1, { durationSeconds: 400 }),
    item('u-boundary', 3, { durationSeconds: 900 }),
    item('u-too-slow', 4, { durationSeconds: 901 }),
    item('v-fast', 5, { durationSeconds: 60, hasVisited: true }),
    item('v-next', 6, { durationSeconds: 300, hasVisited: true }),
    item('v-extra', 7, { durationSeconds: 500, hasVisited: true }),
    item('unverified', 8, {
      durationSeconds: 10,
      verificationStatus: 'needs_review',
    }),
    item('event', 9, { durationSeconds: 10, kind: 'event' }),
  ];
  const nearby = createNearbyRecommendation({
    clock: { now: () => new Date('2026-09-13T12:02:00.000Z') },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    catalog: {
      async list(profile) {
        profiles.push(profile);
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
          attribution: googleAttribution,
        };
      },
    },
    routeProvider: {
      async walking(origin, destination) {
        routeCalls.push({ origin, destination });
        const source = items.find(
          (candidate) => candidate.latitude === destination.latitude,
        );
        return {
          status: 'fresh',
          durationSeconds: source.testDurationSeconds,
          distanceMeters: 700,
          checkedAt: '2026-09-13T12:00:00.000Z',
          attribution: googleAttribution,
        };
      },
    },
  });

  const result = await nearby.execute({ locationHint: '  銀座  ' });

  assert.equal(result.ok, true);
  assert.deepEqual(profiles, ['verified_catalog']);
  assert.equal(routeCalls.length, 7);
  assert.deepEqual(
    result.value.recommendations.map(({ itemId }) => itemId),
    ['u-a', 'u-b', 'u-boundary', 'v-fast', 'v-next'],
  );
  assert.equal(result.value.recommendations.length, 5);
  assert.equal(
    result.value.recommendations.some(({ itemId }) => itemId === 'u-too-slow'),
    false,
  );
  assert.equal(result.value.requestedLocation, '銀座');
  assert.equal(result.value.resolvedLocation, '東京都中央区銀座');
});

test('Nearby uses the batch route capability without changing the ranked result', async () => {
  const items = [
    item('slow', 1, { durationSeconds: 901 }),
    item('eligible', 2, { durationSeconds: 600 }),
    item('visited', 3, { durationSeconds: 120, hasVisited: true }),
  ];
  let matrixCalls = 0;
  const nearby = createNearbyRecommendation({
    clock: { now: () => new Date('2026-09-13T12:02:00.000Z') },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    catalog: {
      async list() {
        return items;
      },
    },
    locationResolver: {
      async resolve() {
        return {
          status: 'resolved',
          location: {
            canonicalAddress: 'Origin',
            point: { latitude: 35.67, longitude: 139.76 },
          },
          attribution: googleAttribution,
        };
      },
    },
    routeProvider: {
      async walking() {
        throw new Error('single-destination route must not be called');
      },
      async walkingMany(_origin, destinations) {
        matrixCalls += 1;
        assert.equal(destinations.length, 3);
        return items.map((candidate) => ({
          status: 'fresh',
          durationSeconds: candidate.testDurationSeconds,
          distanceMeters: 700,
          checkedAt: '2026-09-13T12:00:00.000Z',
          attribution: googleAttribution,
        }));
      },
    },
  });
  const result = await nearby.execute({ locationHint: 'Origin' });
  assert.equal(result.ok, true);
  assert.equal(matrixCalls, 1);
  assert.deepEqual(
    result.value.recommendations.map(({ itemId }) => itemId),
    ['eligible', 'visited'],
  );
});

const googleAttribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation',
};

function item(id, offset, options = {}) {
  return {
    id,
    kind: options.kind ?? 'food',
    title: `Place ${id}`,
    area: 'Ginza',
    address: `${offset} Ginza`,
    description: '',
    latitude: 35.67 + offset / 10_000,
    longitude: 139.76 + offset / 10_000,
    verificationStatus: options.verificationStatus ?? 'verified',
    verifiedAt: '2026-09-13T00:00:00.000Z',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-13T00:00:00.000Z',
    },
    personalState: options.hasVisited ? 'visited' : 'candidate',
    hasVisited: options.hasVisited ?? false,
    tags: [],
    sources: [],
    testDurationSeconds: options.durationSeconds,
  };
}
