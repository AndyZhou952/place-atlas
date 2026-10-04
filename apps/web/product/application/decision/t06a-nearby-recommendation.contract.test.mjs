import assert from 'node:assert/strict';
import test from 'node:test';

import { createT06aNearbyRecommendation } from './t06a-nearby-recommendation.ts';

test('Nearby shortlists verified food by persisted coordinates before requesting walking routes', async () => {
  const routeCalls = [];
  const items = [
    item('far', 0.2),
    item('near-c', 0.003),
    item('near-a', 0.001),
    item('near-b', 0.002),
    item('not-food', 0.0001, { kind: 'event' }),
    item('not-verified', 0.0002, { verificationStatus: 'needs_review' }),
  ];
  const nearby = createT06aNearbyRecommendation({
    shortlistLimit: 3,
    transitShortlistLimit: 2,
    clock: { now: () => new Date('2026-09-15T12:02:00.000Z') },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    catalog: catalogWith(items),
    locationResolver: resolvedOrigin(),
    routeProvider: {
      async walking(_origin, destination) {
        routeCalls.push(destination);
        return freshWalking(600);
      },
    },
  });

  const result = await nearby.execute({ locationHint: '銀座' });

  assert.equal(result.ok, true);
  assert.deepEqual(
    routeCalls,
    ['near-a', 'near-b', 'near-c'].map((id) => {
      const candidate = items.find((value) => value.id === id);
      return {
        latitude: candidate.latitude,
        longitude: candidate.longitude,
      };
    }),
  );
  assert.deepEqual(
    result.value.recommendations.map(({ itemId }) => itemId),
    ['near-a', 'near-b', 'near-c'],
  );
});

const attribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation',
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
    distanceMeters: 700,
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

function item(id, latitudeOffset, options = {}) {
  return {
    id,
    kind: options.kind ?? 'food',
    title: id,
    area: 'Ginza',
    address: `${id} Ginza`,
    description: '',
    latitude: 35.67 + latitudeOffset,
    longitude: 139.76,
    verificationStatus: options.verificationStatus ?? 'verified',
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
