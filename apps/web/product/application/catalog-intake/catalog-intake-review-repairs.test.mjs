import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCatalogIntakeCoordinator,
  createInMemoryCatalogIntakeStore,
} from './catalog-intake-coordinator.ts';

test('a cancelled session ID is terminal and discover replays cancellation without provider egress', async () => {
  const counters = { catalog: 0, provider: 0 };
  const coordinator = coordinatorWith({ candidates: [candidate()], counters });

  const first = await coordinator.handle(discoverEvent('terminal-session'));
  assert.equal(first.ok, true);
  const cancelled = await coordinator.handle({
    type: 'cancel',
    sessionId: 'terminal-session',
  });
  const reopened = await coordinator.handle(discoverEvent('terminal-session'));

  assert.deepEqual(cancelled, { ok: true, value: { status: 'cancelled' } });
  assert.deepEqual(reopened, cancelled);
  assert.equal(counters.catalog, 1);
  assert.equal(counters.provider, 1);
});

test('blank required clues fail before Catalog/provider egress while a blank optional area is omitted', async () => {
  const counters = { catalog: 0, provider: 0 };
  const coordinator = coordinatorWith({ candidates: [candidate()], counters });

  const blankName = await coordinator.handle(
    discoverEvent('blank-name', { kind: 'name', name: '   ', near: ' 银座 ' }),
  );
  const blankAddress = await coordinator.handle(
    discoverEvent('blank-address', { kind: 'address', address: '\t\n' }),
  );

  assert.equal(blankName.ok, false);
  assert.equal(blankName.error.kind, 'invalid_input');
  assert.equal(blankAddress.ok, false);
  assert.equal(blankAddress.error.kind, 'invalid_input');
  assert.equal(counters.catalog, 0);
  assert.equal(counters.provider, 0);

  const valid = await coordinator.handle(
    discoverEvent('blank-near', {
      kind: 'name',
      name: ' 同名店 ',
      near: '   ',
    }),
  );
  assert.equal(valid.ok, true);
  assert.deepEqual(counters.lastRequest, { name: '同名店' });
});

test('durable coordinates do not imply third-party map compatibility or attribution', async () => {
  const denied = await coordinatorWith({ candidates: [candidate()] }).handle(
    discoverEvent('map-denied'),
  );
  assert.deepEqual(denied.value.preview.presentation.map, {
    status: 'unknown',
  });

  const mapPermission = {
    target: 'openstreetmap',
    coordinateField: 'coordinates',
    attribution: {
      label: 'Licensed fixture',
      url: 'https://places.example.test/terms',
    },
  };
  const permitted = await coordinatorWith({
    candidates: [candidate({ mapPermission })],
  }).handle(discoverEvent('map-permitted'));

  assert.equal(permitted.value.preview.presentation.map.status, 'available');
  assert.equal(
    permitted.value.preview.presentation.map.deepLink,
    'https://www.openstreetmap.org/?mlat=35.671&mlon=139.765#map=18/35.671/139.765',
  );
  assert.deepEqual(
    permitted.value.preview.presentation.map.attribution,
    mapPermission.attribution,
  );
});

test('same-name candidates expose sourced branch and area in the selection summary', async () => {
  const coordinator = coordinatorWith({
    candidates: [
      candidate({
        stablePlaceId: 'ginza',
        branch: '銀座店',
        area: '中央区銀座',
      }),
      candidate({
        stablePlaceId: 'roppongi',
        branch: '六本木店',
        area: '港区六本木',
      }),
    ],
  });

  const result = await coordinator.handle(discoverEvent('branches'));

  assert.equal(result.value.status, 'selection_required');
  assert.deepEqual(
    result.value.candidates.map(({ name, branch, area }) => ({
      name,
      branch,
      area,
    })),
    [
      {
        name: '同名店',
        branch: { status: 'known', value: '銀座店' },
        area: { status: 'known', value: '中央区銀座' },
      },
      {
        name: '同名店',
        branch: { status: 'known', value: '六本木店' },
        area: { status: 'known', value: '港区六本木' },
      },
    ],
  );
});

test('a permitted known area is presented and is not listed as unknown', async () => {
  const coordinator = coordinatorWith({
    candidates: [candidate({ area: '中央区銀座' })],
  });

  const result = await coordinator.handle(discoverEvent('known-area'));

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.preview.presentation.area, {
    status: 'known',
    value: '中央区銀座',
  });
  assert.equal(
    result.value.preview.presentation.unknownFields.includes('area'),
    false,
  );
});

function coordinatorWith({
  candidates,
  counters = { catalog: 0, provider: 0 },
}) {
  return createCatalogIntakeCoordinator({
    catalog: {
      async readSnapshot() {
        counters.catalog += 1;
        return { revision: 'catalog-r-review', items: [] };
      },
    },
    discoveryProvider: {
      async discover(request) {
        counters.provider += 1;
        counters.lastRequest = request;
        return { ok: true, value: { candidates } };
      },
    },
    store: createInMemoryCatalogIntakeStore(),
    clock: { now: () => new Date('2026-09-15T10:00:00.000Z') },
  });
}

function discoverEvent(sessionId, query = { kind: 'name', name: '同名店' }) {
  return { type: 'discover', sessionId, query };
}

function candidate(options = {}) {
  const sourceUrl = 'https://places.example.test/place-review';
  const checkedAt = '2026-09-15T09:59:00.000Z';
  const fact = (value) => ({ value, sourceUrl, checkedAt });
  return {
    strongIdentity: {
      providerNamespace: 'licensed-fixture',
      stablePlaceId: options.stablePlaceId ?? 'place-review',
    },
    name: fact(options.name ?? '同名店'),
    address: fact(options.address ?? '東京都中央区銀座1-1-1'),
    branch: options.branch
      ? { status: 'known', ...fact(options.branch) }
      : { status: 'unknown' },
    area: options.area
      ? { status: 'known', ...fact(options.area) }
      : { status: 'unknown' },
    coordinates: fact(
      options.coordinates ?? { latitude: 35.671, longitude: 139.765 },
    ),
    externalRating: { status: 'unknown', reason: 'not_permitted' },
    source: {
      providerId: 'licensed-fixture',
      sourceUrl,
      checkedAt,
      policy: {
        version: 'fixture-policy-v2',
        durableFields: [
          'name',
          'address',
          'coordinates',
          'source_url',
          ...(options.branch ? ['branch'] : []),
          ...(options.area ? ['area'] : []),
        ],
        chatFields: [
          'name',
          'address',
          ...(options.branch ? ['branch'] : []),
          ...(options.area ? ['area'] : []),
        ],
        ...(options.mapPermission
          ? { mapPresentation: options.mapPermission }
          : {}),
      },
    },
  };
}
