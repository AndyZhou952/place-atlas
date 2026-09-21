import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCatalogIntakeCoordinator,
  createInMemoryCatalogIntakeStore,
} from './catalog-intake-coordinator.ts';

test('a name-only discovery reads the catalog before provider discovery and returns an immutable single-candidate preview without writing a place', async () => {
  const calls = [];
  const coordinator = createCatalogIntakeCoordinator({
    catalog: {
      async readSnapshot() {
        calls.push('catalog.read');
        return { revision: 'catalog-r7', items: [] };
      },
    },
    discoveryProvider: {
      async discover(request) {
        calls.push(['provider.discover', request]);
        return {
          ok: true,
          value: { candidates: [candidate()] },
        };
      },
    },
    store: createInMemoryCatalogIntakeStore(),
    clock: { now: () => new Date('2026-09-15T10:00:00.000Z') },
  });

  const result = await coordinator.handle({
    type: 'discover',
    sessionId: 'intake-1',
    query: { kind: 'name', name: '鮨 さいとう' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    'catalog.read',
    ['provider.discover', { name: '鮨 さいとう' }],
  ]);
  assert.equal(result.value.status, 'preview');
  assert.equal(result.value.preview.previewVersion, 1);
  assert.equal(result.value.preview.catalogRevision, 'catalog-r7');
  assert.equal(result.value.preview.evidence.name.value, '鮨 さいとう');
  assert.deepEqual(result.value.preview.presentation, {
    kind: 'food',
    area: { status: 'unknown' },
    map: {
      status: 'available',
      deepLink:
        'https://www.openstreetmap.org/?mlat=35.6658&mlon=139.7407#map=18/35.6658/139.7407',
      attribution: {
        label: 'Licensed fixture',
        url: 'https://places.example.test/terms',
      },
    },
    reservation: { status: 'unknown' },
    unknownFields: ['area', 'external_rating', 'reservation'],
  });
  assert.match(result.value.preview.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(result.value.preview), true);
  assert.equal(Object.isFrozen(result.value.preview.evidence), true);
});

function candidate(overrides = {}) {
  return {
    strongIdentity: {
      providerNamespace: 'licensed-fixture',
      stablePlaceId: 'place-123',
    },
    name: fact('鮨 さいとう'),
    address: fact('東京都港区六本木1-4-5'),
    coordinates: fact({ latitude: 35.6658, longitude: 139.7407 }),
    externalRating: {
      status: 'unknown',
      reason: 'not_permitted',
    },
    source: {
      providerId: 'licensed-fixture',
      sourceUrl: 'https://places.example.test/place-123',
      checkedAt: '2026-09-15T09:59:00.000Z',
      policy: {
        version: 'fixture-policy-v1',
        durableFields: ['name', 'address', 'coordinates', 'source_url'],
        chatFields: ['name', 'address'],
        mapPresentation: {
          target: 'openstreetmap',
          coordinateField: 'coordinates',
          attribution: {
            label: 'Licensed fixture',
            url: 'https://places.example.test/terms',
          },
        },
      },
    },
    ...overrides,
  };
}

function fact(value) {
  return {
    value,
    sourceUrl: 'https://places.example.test/place-123',
    checkedAt: '2026-09-15T09:59:00.000Z',
  };
}

test('discovery accepts name with an optional area and an address-only clue without inventing fields', async () => {
  const requests = [];
  const coordinator = createCatalogIntakeCoordinator({
    catalog: emptyCatalog(),
    discoveryProvider: {
      async discover(request) {
        requests.push(request);
        return { ok: true, value: { candidates: [candidate()] } };
      },
    },
    store: createInMemoryCatalogIntakeStore(),
    clock: { now: () => new Date('2026-09-15T10:00:00.000Z') },
  });

  const named = await coordinator.handle({
    type: 'discover',
    sessionId: 'intake-name-near',
    query: { kind: 'name', name: '鮨 さいとう', near: '六本木' },
  });
  const addressed = await coordinator.handle({
    type: 'discover',
    sessionId: 'intake-address',
    query: { kind: 'address', address: '東京都港区六本木1-4-5' },
  });

  assert.equal(named.ok, true);
  assert.equal(addressed.ok, true);
  assert.deepEqual(requests, [
    { name: '鮨 さいとう', near: '六本木' },
    {
      name: '東京都港区六本木1-4-5',
      address: '東京都港区六本木1-4-5',
    },
  ]);
});

function emptyCatalog() {
  return {
    async readSnapshot() {
      return { revision: 'catalog-r7', items: [] };
    },
  };
}

test('more than one discovery result returns at most three stable candidate IDs and selection uses stored evidence without searching again', async () => {
  let catalogReads = 0;
  let providerCalls = 0;
  const coordinator = createCatalogIntakeCoordinator({
    catalog: {
      async readSnapshot() {
        catalogReads += 1;
        return { revision: 'catalog-r8', items: [] };
      },
    },
    discoveryProvider: {
      async discover() {
        providerCalls += 1;
        return {
          ok: true,
          value: {
            candidates: [
              numberedCandidate(1),
              numberedCandidate(2),
              numberedCandidate(3),
              numberedCandidate(4),
            ],
          },
        };
      },
    },
    store: createInMemoryCatalogIntakeStore(),
    clock: { now: () => new Date('2026-09-15T10:00:00.000Z') },
  });

  const discovered = await coordinator.handle({
    type: 'discover',
    sessionId: 'intake-many',
    query: { kind: 'name', name: '同名店' },
  });

  assert.equal(discovered.ok, true);
  assert.equal(discovered.value.status, 'selection_required');
  assert.equal(discovered.value.candidates.length, 3);
  assert.equal(
    new Set(discovered.value.candidates.map((entry) => entry.candidateId)).size,
    3,
  );

  const selected = await coordinator.handle({
    type: 'select',
    sessionId: 'intake-many',
    candidateId: discovered.value.candidates[1].candidateId,
  });

  assert.equal(selected.ok, true);
  assert.equal(selected.value.status, 'preview');
  assert.equal(selected.value.preview.evidence.name.value, '同名店 2');
  assert.equal(selected.value.preview.catalogRevision, 'catalog-r8');
  assert.equal(catalogReads, 1);
  assert.equal(providerCalls, 1);
});

function numberedCandidate(index) {
  const sourceUrl = `https://places.example.test/place-${index}`;
  const sourced = (value) => ({
    value,
    sourceUrl,
    checkedAt: '2026-09-15T09:59:00.000Z',
  });
  return candidate({
    strongIdentity: {
      providerNamespace: 'licensed-fixture',
      stablePlaceId: `place-${index}`,
    },
    name: sourced(`同名店 ${index}`),
    address: sourced(`東京都中央区銀座${index}`),
    coordinates: sourced({ latitude: 35.67 + index / 1000, longitude: 139.76 }),
    source: {
      providerId: 'licensed-fixture',
      sourceUrl,
      checkedAt: '2026-09-15T09:59:00.000Z',
      policy: {
        version: 'fixture-policy-v1',
        durableFields: ['name', 'address', 'coordinates', 'source_url'],
        chatFields: ['name', 'address'],
      },
    },
  });
}

test('a provider strong identity match reuses the existing Atlas item instead of opening a create preview', async () => {
  const existing = {
    itemId: 'atlas-existing-1',
    name: '鮨 さいとう',
    address: '東京都港区六本木1-4-5',
    coordinates: { latitude: 35.6658, longitude: 139.7407 },
    strongIdentities: [
      {
        providerNamespace: 'licensed-fixture',
        stablePlaceId: 'place-123',
      },
    ],
  };
  const coordinator = createCatalogIntakeCoordinator({
    catalog: {
      async readSnapshot() {
        return { revision: 'catalog-r9', items: [existing] };
      },
    },
    discoveryProvider: {
      async discover() {
        return { ok: true, value: { candidates: [candidate()] } };
      },
    },
    store: createInMemoryCatalogIntakeStore(),
    clock: { now: () => new Date('2026-09-15T10:00:00.000Z') },
  });

  const result = await coordinator.handle({
    type: 'discover',
    sessionId: 'intake-strong-match',
    query: { kind: 'name', name: '鮨 さいとう' },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    status: 'existing_item',
    item: existing,
    match: {
      kind: 'strong_identity',
      providerNamespace: 'licensed-fixture',
      stablePlaceId: 'place-123',
    },
  });
});

test('weak name, address, and coordinate matches are capped hints and never auto-merge a new candidate', async () => {
  const weakItems = [
    catalogItem('same-name', '鮨 さいとう', '別の住所', {
      latitude: 36,
      longitude: 140,
    }),
    catalogItem('same-address', '別の店', '東京都港区六本木1-4-5', {
      latitude: 36,
      longitude: 140,
    }),
    catalogItem('nearby-coordinate', '同じビルの別店舗', '同じビル 2F', {
      latitude: 35.66581,
      longitude: 139.74071,
    }),
    catalogItem('fourth-hint', '鮨 さいとう', 'さらに別の住所', {
      latitude: 36,
      longitude: 140,
    }),
  ];
  const coordinator = createCatalogIntakeCoordinator({
    catalog: {
      async readSnapshot() {
        return { revision: 'catalog-r10', items: weakItems };
      },
    },
    discoveryProvider: {
      async discover() {
        return { ok: true, value: { candidates: [candidate()] } };
      },
    },
    store: createInMemoryCatalogIntakeStore(),
    clock: { now: () => new Date('2026-09-15T10:00:00.000Z') },
  });

  const result = await coordinator.handle({
    type: 'discover',
    sessionId: 'intake-weak-match',
    query: { kind: 'name', name: '鮨 さいとう' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'preview');
  assert.deepEqual(
    result.value.preview.suspectedDuplicates.map((item) => item.itemId),
    ['same-name', 'same-address', 'nearby-coordinate'],
  );
});

function catalogItem(itemId, name, address, coordinates) {
  return {
    itemId,
    name,
    address,
    coordinates,
    strongIdentities: [
      {
        providerNamespace: 'other-provider',
        stablePlaceId: itemId,
      },
    ],
  };
}

test('cancel closes an intake session and its stored candidate IDs cannot be selected afterward', async () => {
  let providerCalls = 0;
  const coordinator = createCatalogIntakeCoordinator({
    catalog: emptyCatalog(),
    discoveryProvider: {
      async discover() {
        providerCalls += 1;
        return {
          ok: true,
          value: { candidates: [numberedCandidate(1), numberedCandidate(2)] },
        };
      },
    },
    store: createInMemoryCatalogIntakeStore(),
    clock: { now: () => new Date('2026-09-15T10:00:00.000Z') },
  });

  const discovered = await coordinator.handle({
    type: 'discover',
    sessionId: 'intake-cancel',
    query: { kind: 'name', name: '同名店' },
  });
  assert.equal(discovered.ok, true);
  const candidateId = discovered.value.candidates[0].candidateId;

  const cancelled = await coordinator.handle({
    type: 'cancel',
    sessionId: 'intake-cancel',
  });
  const staleSelection = await coordinator.handle({
    type: 'select',
    sessionId: 'intake-cancel',
    candidateId,
  });

  assert.deepEqual(cancelled, { ok: true, value: { status: 'cancelled' } });
  assert.equal(staleSelection.ok, false);
  assert.equal(staleSelection.error.kind, 'not_found');
  assert.equal(providerCalls, 1);
});

test('selecting a strong-identity match from multiple candidates reuses the existing item', async () => {
  const existing = {
    ...catalogItem('atlas-existing-2', '同名店 2', '東京都中央区銀座2'),
    strongIdentities: [
      { providerNamespace: 'licensed-fixture', stablePlaceId: 'place-2' },
    ],
  };
  const coordinator = createCatalogIntakeCoordinator({
    catalog: {
      async readSnapshot() {
        return { revision: 'r12', items: [existing] };
      },
    },
    discoveryProvider: {
      async discover() {
        return {
          ok: true,
          value: { candidates: [numberedCandidate(1), numberedCandidate(2)] },
        };
      },
    },
    store: createInMemoryCatalogIntakeStore(),
    clock: { now: () => new Date('2026-09-15T10:00:00.000Z') },
  });

  const discovered = await coordinator.handle({
    type: 'discover',
    sessionId: 'intake-select-existing',
    query: { kind: 'name', name: '同名店' },
  });
  assert.equal(discovered.value.status, 'selection_required');
  const selected = await coordinator.handle({
    type: 'select',
    sessionId: 'intake-select-existing',
    candidateId: discovered.value.candidates[1].candidateId,
  });

  assert.equal(selected.ok, true);
  assert.equal(selected.value.status, 'existing_item');
  assert.equal(selected.value.item.itemId, 'atlas-existing-2');
});
