import assert from 'node:assert/strict';
import test from 'node:test';

import { createNearbyRecommendation } from './nearby-recommendation-operation.ts';

test('Nearby distance fallback includes the 2 km boundary, ranks stably, and returns at most five candidates', async () => {
  const items = [
    item('u-b', 0.004496608, false),
    item('u-a', 0.004496608, false),
    item('u-boundary', 0.01798643211837461, false),
    item('outside', 0.0179955, false),
    item('v-fast', 0.000899322, true),
    item('v-next', 0.008993216, true),
    item('v-extra', 0.013489824, true),
  ];
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
            canonicalAddress: 'Fixture origin',
            point: { latitude: 0, longitude: 0 },
          },
          attribution,
        };
      },
    },
    routeProvider: {
      async walking() {
        return {
          status: 'unavailable',
          warning: 'Walking route unavailable.',
        };
      },
    },
  });

  const result = await nearby.execute({ locationHint: 'Fixture origin' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recommendations, []);
  assert.deepEqual(
    result.value.distanceCandidates.map(({ itemId }) => itemId),
    ['u-a', 'u-b', 'u-boundary', 'v-fast', 'v-next'],
  );
  assert.equal(result.value.distanceCandidates.length, 5);
  assert.equal(
    result.value.distanceCandidates.some(({ itemId }) => itemId === 'outside'),
    false,
  );
  assert.equal(
    result.value.distanceCandidates.find(
      ({ itemId }) => itemId === 'u-boundary',
    ).straightLineDistanceKm <= 2,
    true,
  );
  for (const candidate of result.value.distanceCandidates) {
    assert.equal(
      candidate.warning,
      'Straight-line distance only; travel time is not verified.',
    );
    assert.equal('route' in candidate, false);
  }
});

const attribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation',
};

function item(id, longitude, hasVisited) {
  return {
    id,
    kind: 'food',
    title: `Place ${id}`,
    area: 'Fixture',
    address: `${id} Fixture`,
    description: '',
    latitude: 0,
    longitude,
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
