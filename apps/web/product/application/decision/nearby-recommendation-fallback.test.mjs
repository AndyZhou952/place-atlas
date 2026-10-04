import assert from 'node:assert/strict';
import test from 'node:test';

import { createNearbyRecommendation } from './nearby-recommendation-operation.ts';

test('Nearby returns ambiguous or unresolved location states without reading the catalog', async () => {
  let catalogReads = 0;
  const states = [
    {
      status: 'ambiguous',
      candidates: [
        {
          canonicalAddress: 'A',
          point: { latitude: 35, longitude: 139 },
        },
      ],
      attribution: googleAttribution,
    },
    {
      status: 'unresolved',
      reason: 'not_found',
      warning: 'No matching address was found.',
    },
  ];
  const nearby = createNearbyRecommendation({
    clock: { now: () => new Date('2026-09-13T12:02:00.000Z') },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    catalog: {
      async list() {
        catalogReads += 1;
        return [];
      },
      async get() {
        return undefined;
      },
    },
    locationResolver: {
      async resolve() {
        return states.shift();
      },
    },
    routeProvider: {
      async walking() {
        throw new Error('must not be called');
      },
    },
  });

  const ambiguous = await nearby.execute({ locationHint: '新宿' });
  const unresolved = await nearby.execute({ locationHint: 'missing' });

  assert.equal(ambiguous.ok, true);
  assert.equal(ambiguous.value.status, 'ambiguous');
  assert.equal(unresolved.ok, true);
  assert.equal(unresolved.value.status, 'unresolved');
  assert.equal(catalogReads, 0);
});

test('Nearby route failures expose only straight-line estimates with explicit warnings', async () => {
  const items = [item('provider-unavailable', 1), item('provider-threw', 2)];
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
          attribution: googleAttribution,
        };
      },
    },
    routeProvider: {
      async walking(_origin, destination) {
        if (destination.latitude === items[1].latitude) {
          throw new Error('secret provider response');
        }
        return {
          status: 'unavailable',
          warning: 'Live walking route is temporarily unavailable.',
        };
      },
    },
  });

  const result = await nearby.execute({ locationHint: '銀座' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recommendations, []);
  assert.deepEqual(
    result.value.unavailableRoutes.map(({ itemId, warning }) => ({
      itemId,
      warning,
    })),
    [
      {
        itemId: 'provider-unavailable',
        warning: 'Live walking route is temporarily unavailable.',
      },
      {
        itemId: 'provider-threw',
        warning: 'Walking route is temporarily unavailable.',
      },
    ],
  );
  for (const unavailable of result.value.unavailableRoutes) {
    assert.equal(typeof unavailable.straightLineDistanceKm, 'number');
    assert.equal('durationSeconds' in unavailable, false);
    assert.equal('walkingMinutes' in unavailable, false);
  }
});
test('Nearby rejects old, future, and invalid route timestamps as stale evidence', async () => {
  const items = [item('old', 1), item('future', 2), item('invalid', 3)];
  const checkedAtById = {
    old: '2026-09-13T12:04:59.000Z',
    future: '2026-09-13T12:10:01.000Z',
    invalid: 'not-a-date',
  };
  const nearby = createNearbyRecommendation({
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
          attribution: googleAttribution,
        };
      },
    },
    routeProvider: {
      async walking(_origin, destination) {
        const source = items.find(
          (candidate) => candidate.latitude === destination.latitude,
        );
        return {
          status: 'fresh',
          durationSeconds: 60,
          distanceMeters: 100,
          checkedAt: checkedAtById[source.id],
          attribution: googleAttribution,
        };
      },
    },
    transitRouteProvider: {
      async transit() {
        return {
          status: 'fresh',
          durationSeconds: 600,
          boardingCount: 1,
          lineIdentities: ['Ginza Line'],
          transferCount: 0,
          checkedAt: '2026-09-13T12:04:59.000Z',
          attribution: googleAttribution,
        };
      },
    },
    clock: { now: () => new Date('2026-09-13T12:10:00.000Z') },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
  });

  const result = await nearby.execute({ locationHint: '銀座' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recommendations, []);
  assert.deepEqual(result.value.directTransitCandidates, []);
  assert.deepEqual(
    result.value.unavailableRoutes.map(({ itemId, warning }) => ({
      itemId,
      warning,
    })),
    items.map(({ id }) => ({
      itemId: id,
      warning: 'Walking route evidence is stale or invalid.',
    })),
  );
  for (const route of result.value.unavailableRoutes) {
    assert.equal('durationSeconds' in route, false);
  }
});

const googleAttribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation',
};

function item(id, offset) {
  return {
    id,
    kind: 'food',
    title: `Place ${id}`,
    area: 'Ginza',
    address: `${offset} Ginza`,
    description: '',
    latitude: 35.67 + offset / 10_000,
    longitude: 139.76 + offset / 10_000,
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
