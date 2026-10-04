import assert from 'node:assert/strict';
import test from 'node:test';

import { createT06aGoogleNearbyComposition } from './t06a-google-nearby-composition.ts';

test('a missing Google key selects the disabled gateway before DNS, quota, or fetch', async () => {
  let dnsLookups = 0;
  let reservations = 0;
  let fetches = 0;
  const composition = createT06aGoogleNearbyComposition({
    database: {
      prepare() {
        return {
          async all() {
            return { results: [] };
          },
          bind() {
            return {
              async first() {
                return null;
              },
            };
          },
        };
      },
    },
    googleMapsApiKey: undefined,
    resolve: async () => {
      dnsLookups += 1;
      return ['8.8.8.8'];
    },
    usage: {
      async reserve() {
        reservations += 1;
        return 'reserved';
      },
    },
    fetch: async () => {
      fetches += 1;
      return new Response('{}', { status: 200 });
    },
  });

  const outcome = await composition.agentNearby.nearbyRecommendation.execute({
    locationHint: '銀座',
  });

  assert.equal(outcome.ok, true);
  assert.equal(dnsLookups, 0);
  assert.equal(reservations, 0);
  assert.equal(fetches, 0);
});
