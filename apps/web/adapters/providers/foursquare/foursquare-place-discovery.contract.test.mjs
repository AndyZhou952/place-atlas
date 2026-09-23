import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapFoursquarePlacesResponse,
  mapFoursquarePolicyFields,
} from './foursquare-place-discovery-mapper.ts';
import { foursquarePlacesApiNewJapanResponseFixture } from './fixtures/foursquare-places-api-new-japan-response.fixture.mjs';
import { createFoursquarePlaceDiscoveryProvider } from './foursquare-place-discovery-provider.ts';

const sourceUrl =
  'https://places-api.foursquare.com/places/search?query=%E6%9E%B6%E7%A9%BA%E5%AF%BF%E5%8F%B8';

test('Foursquare Places API New mapper keeps only stable identity, name, address, and coordinates', () => {
  const fields = mapFoursquarePlacesResponse({
    results: [
      {
        fsq_place_id: 'fsq-tokyo-branch-1',
        name: '架空寿司 銀座店',
        location: { formatted_address: '東京都中央区銀座1-1' },
        latitude: 35.6717,
        longitude: 139.765,
        rating: 9.9,
        descriptions: ['raw provider content must not escape'],
        unrelated_debug: 'must not escape',
      },
    ],
  });

  assert.deepEqual(fields, {
    fsqPlaceId: ['fsq-tokyo-branch-1'],
    name: ['架空寿司 銀座店'],
    formattedAddress: ['東京都中央区銀座1-1'],
    coordinates: [{ latitude: 35.6717, longitude: 139.765 }],
  });
  assert.equal('rating' in fields, false);
  assert.equal('descriptions' in fields, false);
  assert.equal('unrelated_debug' in fields, false);
});

test('Foursquare discovery returns zero, one, or at most three stable candidates with rating unknown', async () => {
  const resultSets = [
    {
      fsqPlaceId: [],
      name: [],
      formattedAddress: [],
      coordinates: [],
      rating: { status: 'unknown', reason: 'not_permitted' },
    },
    {
      fsqPlaceId: ['fsq-tokyo-branch-1'],
      name: ['架空寿司 銀座店'],
      formattedAddress: ['東京都中央区銀座1-1'],
      coordinates: [{ latitude: 35.6717, longitude: 139.765 }],
      rating: { status: 'unknown', reason: 'not_permitted' },
    },
    {
      fsqPlaceId: ['fsq-1', 'fsq-2', 'fsq-3', 'fsq-4'],
      name: [
        '同名食堂 銀座店',
        '同名食堂 築地店',
        '同名食堂 上野店',
        '同名食堂 池袋店',
      ],
      formattedAddress: ['銀座1-1', '築地2-2', '上野3-3', '池袋4-4'],
      coordinates: [
        { latitude: 35.67, longitude: 139.76 },
        { latitude: 35.66, longitude: 139.77 },
        { latitude: 35.71, longitude: 139.78 },
        { latitude: 35.73, longitude: 139.71 },
      ],
      rating: { status: 'unknown', reason: 'not_permitted' },
    },
  ];
  const requests = [];
  const provider = createFoursquarePlaceDiscoveryProvider({
    gateway: {
      async invoke(request) {
        requests.push(request);
        return {
          ok: true,
          value: {
            providerId: 'foursquare-places-api-new',
            policyVersion: 'foursquare-fixture-v1',
            sourceUrl,
            fields: resultSets.shift(),
            attribution: {
              label: 'Foursquare',
              url: 'https://foursquare.com/products/places',
            },
            cache: { mode: 'request_only' },
          },
        };
      },
    },
    clock: { now: () => '2026-09-13T12:00:00.000Z' },
    estimatedCostUsd: 0.015,
  });

  const empty = await provider.discover({ name: '架空寿司', near: '銀座' });
  const one = await provider.discover({ name: '架空寿司' });
  const multiple = await provider.discover({ name: '同名食堂' });

  assert.equal(empty.ok, true);
  assert.equal(one.ok, true);
  assert.equal(multiple.ok, true);
  if (!empty.ok || !one.ok || !multiple.ok) return;
  assert.deepEqual(empty.value.candidates, []);
  assert.deepEqual(one.value.candidates, [
    {
      strongIdentity: {
        providerNamespace: 'foursquare-places-api-new',
        stablePlaceId: 'fsq-tokyo-branch-1',
      },
      name: {
        value: '架空寿司 銀座店',
        sourceUrl,
        checkedAt: '2026-09-13T12:00:00.000Z',
      },
      address: {
        value: '東京都中央区銀座1-1',
        sourceUrl,
        checkedAt: '2026-09-13T12:00:00.000Z',
      },
      coordinates: {
        value: { latitude: 35.6717, longitude: 139.765 },
        sourceUrl,
        checkedAt: '2026-09-13T12:00:00.000Z',
      },
      externalRating: { status: 'unknown', reason: 'not_permitted' },
      source: {
        providerId: 'foursquare-places-api-new',
        sourceUrl,
        checkedAt: '2026-09-13T12:00:00.000Z',
      },
    },
  ]);
  assert.deepEqual(
    multiple.value.candidates.map(
      (candidate) => candidate.strongIdentity.stablePlaceId,
    ),
    ['fsq-1', 'fsq-2', 'fsq-3'],
  );
  assert.deepEqual(requests[0], {
    providerId: 'foursquare-places-api-new',
    credentialScope: 'places.search',
    method: 'GET',
    url: 'https://places-api.foursquare.com/places/search?query=%E6%9E%B6%E7%A9%BA%E5%AF%BF%E5%8F%B8&near=%E9%8A%80%E5%BA%A7',
    fields: [
      { name: 'fsqPlaceId', use: 'durable' },
      { name: 'name', use: 'durable' },
      { name: 'formattedAddress', use: 'durable' },
      { name: 'coordinates', use: 'durable' },
      { name: 'rating', use: 'chat', whenDenied: 'unknown' },
    ],
    cache: { mode: 'request_only' },
    estimatedCostUsd: 0.015,
  });
});

test('Foursquare discovery fails closed for pending policy, malformed fields, and provider errors', async () => {
  const pending = createFoursquarePlaceDiscoveryProvider({
    gateway: {
      async invoke() {
        return {
          ok: false,
          error: { kind: 'policy_denied', message: 'must not expose' },
        };
      },
    },
    clock: { now: () => '2026-09-13T12:00:00.000Z' },
    estimatedCostUsd: 0.015,
  });
  const pendingResult = await pending.discover({ name: '架空寿司' });
  assert.deepEqual(pendingResult, {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'Place discovery is temporarily unavailable.',
    },
  });
  assert.equal(
    mapFoursquarePolicyFields({
      fsqPlaceId: ['id'],
      name: ['name'],
      formattedAddress: ['address'],
      coordinates: [{ latitude: 35, longitude: '139' }],
      rating: { status: 'unknown', reason: 'not_permitted' },
    }),
    undefined,
  );
  assert.equal(
    mapFoursquarePlacesResponse({ error: 'provider body' }),
    undefined,
  );
});
test('Foursquare mapper accepts Places API New top-level coordinates from a Japan response', () => {
  const fields = mapFoursquarePlacesResponse(
    foursquarePlacesApiNewJapanResponseFixture,
  );

  assert.deepEqual(fields, {
    fsqPlaceId: ['fsq-japan-sample-1'],
    name: ['架空食堂 東京店'],
    formattedAddress: ['東京都千代田区丸の内1丁目'],
    coordinates: [{ latitude: 35.6812, longitude: 139.7671 }],
  });
  assert.equal(
    'geocodes' in foursquarePlacesApiNewJapanResponseFixture.results[0],
    false,
  );
});

test('Foursquare mapper fails closed for legacy, out-of-range, and non-numeric coordinates', () => {
  const stableFields = {
    fsq_place_id: 'fsq-invalid-coordinate',
    name: '座標不明の架空店',
    location: { formatted_address: '東京都内' },
  };

  const invalidPayloads = [
    {
      label: 'legacy nested coordinates only',
      payload: {
        results: [
          {
            ...stableFields,
            geocodes: {
              main: { latitude: 35.6812, longitude: 139.7671 },
            },
          },
        ],
      },
    },
    {
      label: 'out-of-range latitude',
      payload: {
        results: [{ ...stableFields, latitude: 90.0001, longitude: 139.7671 }],
      },
    },
    {
      label: 'out-of-range longitude',
      payload: {
        results: [{ ...stableFields, latitude: 35.6812, longitude: -180.0001 }],
      },
    },
    {
      label: 'non-numeric latitude',
      payload: {
        results: [
          { ...stableFields, latitude: '35.6812', longitude: 139.7671 },
        ],
      },
    },
    {
      label: 'non-numeric longitude',
      payload: {
        results: [
          { ...stableFields, latitude: 35.6812, longitude: '139.7671' },
        ],
      },
    },
  ];

  for (const { label, payload } of invalidPayloads) {
    assert.equal(
      mapFoursquarePlacesResponse(payload),
      undefined,
      `${label} must abstain`,
    );
  }
});
