import assert from 'node:assert/strict';
import test from 'node:test';

import { createT06aGoogleNearbyComposition } from './t06a-google-nearby-composition.ts';

test('the isolated T-06A composition reads the D1 catalog but closes Google Nearby before DNS or fetch while its policy is pending', async () => {
  let catalogReads = 0;
  let fetches = 0;
  let dnsLookups = 0;
  let reservations = 0;
  const composition = createT06aGoogleNearbyComposition({
    database: {
      prepare(sql) {
        assert.match(sql, /FROM agent_catalog_items/u);
        return {
          async all() {
            catalogReads += 1;
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
    googleMapsApiKey: 'test-only-key',
    fetch: async () => {
      fetches += 1;
      return new Response('{}', { status: 200 });
    },
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
    clock: { now: () => new Date('2026-09-17T12:00:00.000Z') },
  });

  await composition.catalogRead.list('verified_catalog');
  const outcome = await composition.agentNearby.nearbyRecommendation.execute({
    locationHint: '銀座',
  });

  assert.equal(catalogReads, 1);
  assert.deepEqual(outcome, {
    ok: true,
    value: {
      status: 'unresolved',
      reason: 'dependency_failure',
      warning: 'Address lookup is temporarily unavailable.',
    },
  });
  assert.equal(dnsLookups, 0);
  assert.equal(reservations, 0);
  assert.equal(fetches, 0);
});
