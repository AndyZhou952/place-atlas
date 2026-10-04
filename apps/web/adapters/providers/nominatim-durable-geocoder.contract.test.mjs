import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createInMemoryDurableGeocoderCache,
  createNominatimApplicationRateGate,
  createNominatimDurableGeocoderAdapter,
} from './nominatim-durable-geocoder.ts';

test('Nominatim maps one user-triggered public place query to licensed durable evidence', async () => {
  const requests = [];
  const clock = { now: () => new Date('2026-09-22T10:00:00.000Z') };
  const adapter = createNominatimDurableGeocoderAdapter({
    endpoint: 'https://nominatim.openstreetmap.org/search',
    identifyingUserAgent: 'JapanAtlasOwnerPoC/1.0 (owner@example.test)',
    referer: 'https://japan-atlas.example.test/',
    transport: {
      async search(request) {
        requests.push(request);
        return {
          ok: true,
          value: [
            {
              place_id: 123,
              osm_type: 'node',
              osm_id: 456,
              display_name: '東京都中央区銀座4丁目1-2, 日本',
              lat: '35.6717',
              lon: '139.7650',
            },
          ],
        };
      },
    },
    cache: createInMemoryDurableGeocoderCache(),
    rateGate: createNominatimApplicationRateGate(clock),
    clock,
  });

  const result = await adapter.propose({
    trigger: 'owner_intake_select',
    dataClassification: 'public_place_query',
    ownerQuery: '銀座 鮨青空',
    ownerDraft: { title: '鮨青空', area: '銀座' },
  });

  assert.deepEqual(requests, [
    {
      url: 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=%E9%AE%A8%E9%9D%92%E7%A9%BA%20%E9%8A%80%E5%BA%A7',
      headers: {
        'User-Agent': 'JapanAtlasOwnerPoC/1.0 (owner@example.test)',
        Referer: 'https://japan-atlas.example.test/',
      },
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      status: 'resolved',
      normalizedAddress: '東京都中央区銀座4丁目1-2, 日本',
      latitude: 35.6717,
      longitude: 139.765,
      provider: 'nominatim.openstreetmap.org',
      sourceUrl: 'https://www.openstreetmap.org/node/456',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-22T10:00:00.000Z',
    },
  });
});

test('Nominatim uses the selected Google candidate address without persisting it', async () => {
  const requests = [];
  const clock = { now: () => new Date('2026-09-22T10:00:00.000Z') };
  const adapter = createNominatimDurableGeocoderAdapter({
    endpoint: 'https://nominatim.openstreetmap.org/search',
    identifyingUserAgent: 'JapanAtlasOwnerPoC/1.0 (owner@example.test)',
    referer: 'https://japan-atlas.example.test/',
    transport: {
      async search(request) {
        requests.push(request);
        return { ok: true, value: [] };
      },
    },
    cache: createInMemoryDurableGeocoderCache(),
    rateGate: createNominatimApplicationRateGate(clock),
    clock,
  });

  await adapter.propose({
    trigger: 'owner_intake_select',
    dataClassification: 'public_place_query',
    ownerQuery: '東京麺通団',
    ownerDraft: {},
    selectedSubject: {
      ownerQuery: '東京麺通団',
      providerNamespace: 'google-places',
      placeId: 'selected-branch',
      transientName: 'Tōkyō Mentsūdan',
      transientAddress: '7-9-15 Nishishinjuku, Shinjuku City, Tokyo',
    },
  });

  assert.match(
    requests[0].url,
    /q=T%C5%8Dky%C5%8D%20Ments%C5%ABdan%207-9-15%20Nishishinjuku/,
  );
});

test('overseas location lookup does not combine a restaurant name with an already complete street address', async () => {
  const requests = [];
  const clock = { now: () => new Date('2026-09-28T00:00:00.000Z') };
  const adapter = createNominatimDurableGeocoderAdapter({
    endpoint: 'https://nominatim.openstreetmap.org/search',
    identifyingUserAgent: 'JapanAtlasOwnerPoC/1.0 (owner@example.test)',
    referer: 'https://japan-atlas.example.test/',
    transport: {
      async search(request) {
        requests.push(request);
        return { ok: true, value: [] };
      },
    },
    cache: createInMemoryDurableGeocoderCache(),
    rateGate: createNominatimApplicationRateGate(clock),
    clock,
  });
  await adapter.propose({
    trigger: 'owner_intake_select',
    dataClassification: 'public_place_query',
    ownerQuery: 'Burnt Ends Singapore Dempsey',
    ownerDraft: {},
    selectedSubject: {
      ownerQuery: 'Burnt Ends Singapore Dempsey',
      providerNamespace: 'google-places',
      placeId: 'selected-burnt-ends',
      transientName: 'Burnt Ends',
      transientAddress: '7 Dempsey Rd, #01-02, Singapore 249671',
    },
  });
  assert.equal(
    new URL(requests[0].url).searchParams.get('q'),
    '7 Dempsey Rd, #01-02, Singapore 249671',
  );
});

test('Nominatim retries a failed Google candidate using the owner-entered address alone', async () => {
  const requests = [];
  const clock = { now: () => new Date('2026-09-22T10:00:00.000Z') };
  const adapter = createNominatimDurableGeocoderAdapter({
    endpoint: 'https://nominatim.openstreetmap.org/search',
    identifyingUserAgent: 'JapanAtlasOwnerPoC/1.0 (owner@example.test)',
    referer: 'https://japan-atlas.example.test/',
    transport: {
      async search(request) {
        requests.push(request);
        return { ok: true, value: [] };
      },
    },
    cache: createInMemoryDurableGeocoderCache(),
    rateGate: createNominatimApplicationRateGate(clock),
    clock,
  });
  await adapter.propose({
    trigger: 'owner_intake_select',
    dataClassification: 'public_place_query',
    ownerQuery: 'shake shack shinjuku',
    ownerDraft: { address: '東京都渋谷区代々木2-2-1' },
    selectedSubject: {
      ownerQuery: 'shake shack shinjuku',
      providerNamespace: 'google-places',
      placeId: 'selected-branch',
      transientName: 'SHAKE SHACK Shinjuku Southern Terrace',
      transientAddress: 'Google transient address',
    },
  });
  assert.equal(
    new URL(requests[0].url).searchParams.get('q'),
    '東京都渋谷区代々木2-2-1',
  );
});

test('Nominatim rejects non-owner, non-public, or expanded input before cache, rate, or transport', async () => {
  let transportCalls = 0;
  const clock = { now: () => new Date('2026-09-22T10:00:00.000Z') };
  const adapter = createNominatimDurableGeocoderAdapter({
    endpoint: 'https://nominatim.openstreetmap.org/search',
    identifyingUserAgent: 'JapanAtlasOwnerPoC/1.0 (owner@example.test)',
    referer: 'https://japan-atlas.example.test/',
    transport: {
      async search() {
        transportCalls += 1;
        return { ok: true, value: [] };
      },
    },
    cache: createInMemoryDurableGeocoderCache(),
    rateGate: createNominatimApplicationRateGate(clock),
    clock,
  });

  for (const input of [
    {
      trigger: 'background_refresh',
      dataClassification: 'public_place_query',
      ownerQuery: '鮨青空',
      ownerDraft: {},
    },
    {
      trigger: 'owner_intake_select',
      dataClassification: 'private_note',
      ownerQuery: '鮨青空',
      ownerDraft: {},
    },
    {
      trigger: 'owner_intake_select',
      dataClassification: 'public_place_query',
      ownerQuery: '鮨青空',
      ownerDraft: { privateNote: 'do not send' },
    },
  ]) {
    const result = await adapter.propose(input);
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'invalid_input');
  }
  assert.equal(transportCalls, 0);
});

test('Nominatim keeps the owner restaurant query when the draft supplies only an area', async () => {
  const requests = [];
  const clock = { now: () => new Date('2026-09-22T10:00:00.000Z') };
  const adapter = createNominatimDurableGeocoderAdapter({
    endpoint: 'https://nominatim.openstreetmap.org/search',
    identifyingUserAgent: 'JapanAtlasOwnerPoC/1.0 (owner@example.test)',
    referer: 'https://japan-atlas.example.test/',
    transport: {
      async search(request) {
        requests.push(request);
        return { ok: true, value: [] };
      },
    },
    cache: createInMemoryDurableGeocoderCache(),
    rateGate: createNominatimApplicationRateGate(clock),
    clock,
  });

  await adapter.propose({
    trigger: 'owner_intake_select',
    dataClassification: 'public_place_query',
    ownerQuery: '鮨青空',
    ownerDraft: { area: '銀座' },
  });

  assert.equal(
    requests[0].url,
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=%E9%AE%A8%E9%9D%92%E7%A9%BA%20%E9%8A%80%E5%BA%A7',
  );
});

test('Nominatim allows Owner confirm refresh and reuses the shared durable cache', async () => {
  let transportCalls = 0;
  const clock = { now: () => new Date('2026-09-22T10:00:00.000Z') };
  const adapter = createNominatimDurableGeocoderAdapter({
    endpoint: 'https://nominatim.openstreetmap.org/search',
    identifyingUserAgent:
      'JapanAtlasOwnerPoC/1.0 (+https://example.test/terms)',
    referer: 'https://example.test/',
    transport: {
      async search() {
        transportCalls += 1;
        return { ok: true, value: [] };
      },
    },
    cache: createInMemoryDurableGeocoderCache(),
    rateGate: createNominatimApplicationRateGate(clock),
    clock,
  });
  const input = {
    dataClassification: 'public_place_query',
    ownerQuery: '鮨青空',
    ownerDraft: { area: '銀座' },
  };
  await adapter.propose({ ...input, trigger: 'owner_intake_select' });
  const refreshed = await adapter.propose({
    ...input,
    trigger: 'owner_intake_confirm',
  });
  assert.deepEqual(refreshed, { ok: true, value: { status: 'no_match' } });
  assert.equal(transportCalls, 1);
});

test('Nominatim ignores damaged cache data and keeps the official endpoint replaceable only at the port seam', async () => {
  let transportCalls = 0;
  const clock = { now: () => new Date('2026-09-22T10:00:00.000Z') };
  const cache = {
    async get() {
      return {
        status: 'resolved',
        normalizedAddress: '東京都中央区銀座4丁目1-2',
        latitude: 35.6717,
        longitude: 139.765,
        provider: 'nominatim.openstreetmap.org',
        sourceUrl: 'https://www.openstreetmap.org/node/456',
        license: 'OpenStreetMap contributors, ODbL 1.0',
        checkedAt: '2026-09-22T10:00:00.000Z',
        stalePrivateField: 'must not cross the cache seam',
      };
    },
    async set() {},
  };
  const adapter = createNominatimDurableGeocoderAdapter({
    endpoint: 'https://nominatim.openstreetmap.org/search',
    identifyingUserAgent: 'JapanAtlasOwnerPoC/1.0 (owner@example.test)',
    referer: 'https://japan-atlas.example.test/',
    transport: {
      async search() {
        transportCalls += 1;
        return { ok: true, value: [] };
      },
    },
    cache,
    rateGate: createNominatimApplicationRateGate(clock),
    clock,
  });

  const result = await adapter.propose({
    trigger: 'owner_intake_select',
    dataClassification: 'public_place_query',
    ownerQuery: '鮨青空',
    ownerDraft: {},
  });

  assert.equal(transportCalls, 1);
  assert.deepEqual(result, { ok: true, value: { status: 'no_match' } });

  const alternateEndpoint = createNominatimDurableGeocoderAdapter({
    endpoint: 'https://proxy.example.test/search',
    identifyingUserAgent: 'JapanAtlasOwnerPoC/1.0 (owner@example.test)',
    referer: 'https://japan-atlas.example.test/',
    transport: {
      async search() {
        throw new Error('must not fetch an arbitrary endpoint');
      },
    },
    cache: createInMemoryDurableGeocoderCache(),
    rateGate: createNominatimApplicationRateGate(clock),
    clock,
  });
  const unavailable = await alternateEndpoint.propose({
    trigger: 'owner_intake_select',
    dataClassification: 'public_place_query',
    ownerQuery: '鮨青空',
    ownerDraft: {},
  });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.kind, 'dependency_failure');
});
