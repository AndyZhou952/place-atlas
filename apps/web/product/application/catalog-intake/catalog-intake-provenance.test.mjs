import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCatalogIntakeCoordinator,
  createInMemoryCatalogIntakeStore,
} from './catalog-intake-coordinator.ts';

test('only a permitted external rating with complete provenance enters immutable evidence', async () => {
  const permitted = discoveredCandidate({
    externalRating: {
      status: 'known',
      score: 4.2,
      platform: 'licensed-ratings',
      reviewCount: 81,
      sourceUrl: 'https://places.example.test/place-123',
      checkedAt: '2026-09-15T09:59:00.000Z',
    },
    durableFields: [
      'name',
      'address',
      'coordinates',
      'source_url',
      'external_rating',
      'review_count',
    ],
  });
  const accepted = await coordinatorFor(permitted).handle(
    discoverEvent('accepted'),
  );

  assert.equal(accepted.ok, true);
  assert.deepEqual(
    accepted.value.preview.evidence.externalRating,
    permitted.externalRating,
  );

  const missingPermission = discoveredCandidate({
    externalRating: permitted.externalRating,
  });
  const rejected = await coordinatorFor(missingPermission).handle(
    discoverEvent('rejected'),
  );

  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.kind, 'dependency_failure');
});

function coordinatorFor(candidate) {
  return createCatalogIntakeCoordinator({
    catalog: {
      async readSnapshot() {
        return { revision: 'catalog-r11', items: [] };
      },
    },
    discoveryProvider: {
      async discover() {
        return { ok: true, value: { candidates: [candidate] } };
      },
    },
    store: createInMemoryCatalogIntakeStore(),
    clock: { now: () => new Date('2026-09-15T10:00:00.000Z') },
  });
}

function discoverEvent(sessionId) {
  return {
    type: 'discover',
    sessionId,
    query: { kind: 'name', name: '鮨 さいとう' },
  };
}

function discoveredCandidate(options = {}) {
  const sourceUrl = 'https://places.example.test/place-123';
  const checkedAt = '2026-09-15T09:59:00.000Z';
  const fact = (value) => ({ value, sourceUrl, checkedAt });
  return {
    strongIdentity: {
      providerNamespace: 'licensed-fixture',
      stablePlaceId: 'place-123',
    },
    name: fact('鮨 さいとう'),
    address: fact('東京都港区六本木1-4-5'),
    coordinates: fact({ latitude: 35.6658, longitude: 139.7407 }),
    externalRating: options.externalRating ?? {
      status: 'unknown',
      reason: 'not_permitted',
    },
    source: {
      providerId: 'licensed-fixture',
      sourceUrl,
      checkedAt,
      policy: {
        version: 'fixture-policy-v1',
        durableFields: options.durableFields ?? [
          'name',
          'address',
          'coordinates',
          'source_url',
        ],
        chatFields: ['name', 'address'],
      },
    },
  };
}
