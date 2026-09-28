import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGooglePlaceRatingClient,
  createGooglePlacesNewClient,
} from './google-places-new-client.ts';

test('Google rating details use Enterprise fields, exact selected ID, quota, and no cache', async () => {
  const calls = [];
  const client = createGooglePlaceRatingClient({
    apiKey: 'fixture-secret',
    usage: {
      async reserve(value) {
        calls.push(value);
        return 'reserved';
      },
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        id: 'ChIJ1234567890',
        rating: 4.6,
        userRatingCount: 1200,
        googleMapsUri: 'https://www.google.com/maps/place/example',
      });
    },
  });
  const result = await client.getRating('ChIJ1234567890');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    score: 4.6,
    reviewCount: 1200,
    url: 'https://www.google.com/maps/place/example',
  });
  assert.equal(calls[0].sku, 'places.details_rating.requests');
  assert.equal(
    calls[1].init.headers['X-Goog-FieldMask'],
    'id,rating,userRatingCount,googleMapsUri',
  );
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.redirect, 'manual');
});

test('Google rating details reject another branch and unsupported URL', async () => {
  for (const value of [
    {
      id: 'wrong-branch',
      rating: 4.6,
      userRatingCount: 100,
      googleMapsUri: 'https://www.google.com/maps/place/example',
    },
    {
      id: 'ChIJ1234567890',
      rating: 4.6,
      userRatingCount: 100,
      googleMapsUri: 'https://evil.example/maps',
    },
  ]) {
    const client = createGooglePlaceRatingClient({
      apiKey: 'fixture-secret',
      usage: {
        async reserve() {
          return 'reserved';
        },
      },
      fetch: async () => Response.json(value),
    });
    assert.equal((await client.getRating('ChIJ1234567890')).ok, false);
  }
});

test('Google rating remains usable when review count is absent', async () => {
  const client = createGooglePlaceRatingClient({
    apiKey: 'fixture-secret',
    usage: {
      async reserve() {
        return 'reserved';
      },
    },
    fetch: async () =>
      Response.json({
        id: 'ChIJ1234567890',
        rating: 4.1,
        googleMapsUri: 'https://maps.google.com/?cid=123',
      }),
  });
  assert.deepEqual((await client.getRating('ChIJ1234567890')).value, {
    score: 4.1,
    url: 'https://maps.google.com/?cid=123',
  });
});

test('Places New uses fixed Pro field masks, a server header secret, and one bounded page', async () => {
  const requests = [];
  const client = createGooglePlacesNewClient({
    apiKey: 'fixture-secret-never-returned',
    usage: {
      async reserve() {
        return 'reserved';
      },
    },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        places: [
          place('a', '鮨 A', '銀座 A'),
          place('b', '鮨 B', '銀座 B'),
          place('c', '鮨 C', '銀座 C'),
          place('d', '鮨 D', '銀座 D'),
        ],
      });
    },
  });

  const result = await client.searchText({ query: '銀座 鮨' });

  assert.equal(result.ok, true);
  assert.equal(result.value.hasMore, true);
  assert.equal(result.value.places.length, 4);
  assert.deepEqual(
    requests.map(({ url }) => url),
    ['https://places.googleapis.com/v1/places:searchText'],
  );
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.redirect, 'manual');
  assert.equal(
    requests[0].init.headers['X-Goog-FieldMask'],
    'places.id,places.displayName,places.formattedAddress',
  );
  assert.equal(
    requests[0].init.headers['X-Goog-Api-Key'],
    'fixture-secret-never-returned',
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    textQuery: '銀座 鮨',
    pageSize: 4,
  });
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret/u);
});

test('Places New details fixes the endpoint and rejects redirects, oversized, malformed, and mismatched responses', async () => {
  const responses = [
    new Response(null, {
      status: 302,
      headers: { location: 'https://evil.test' },
    }),
    new Response('x'.repeat(70_000), {
      headers: {
        'content-length': '70000',
        'content-type': 'application/json',
      },
    }),
    Response.json({
      id: 'different',
      displayName: { text: 'A' },
      formattedAddress: 'B',
    }),
  ];
  const client = createGooglePlacesNewClient({
    apiKey: 'fixture-secret',
    usage: {
      async reserve() {
        return 'reserved';
      },
    },
    fetch: async () => responses.shift(),
  });

  for (const placeId of ['place-a', 'place-a', 'place-a']) {
    const result = await client.getPlace({ placeId });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'dependency_failure');
  }
});

test('Places New reserves before every egress and does not refund provider failures', async () => {
  const order = [];
  const client = createGooglePlacesNewClient({
    apiKey: 'fixture-secret',
    usage: {
      async reserve(input) {
        order.push(['reserve', input]);
        return order.length === 1 ? 'reserved' : 'quota_exceeded';
      },
    },
    fetch: async () => {
      order.push(['fetch']);
      return new Response('provider failed', { status: 503 });
    },
  });

  assert.equal((await client.searchText({ query: 'A' })).ok, false);
  assert.equal((await client.searchText({ query: 'B' })).ok, false);
  assert.deepEqual(
    order.map(([step]) => step),
    ['reserve', 'fetch', 'reserve'],
  );
  assert.equal(order[0][1].sku, 'places.search_text.requests');
  assert.equal(order[0][1].costUsd, 0.032);
  assert.equal(order[0][1].hardRequestLimit, 1000);
  assert.equal(order[0][1].hardCostLimitUsd, 32);
});

test('Places New missing secret fails before quota or fetch', async () => {
  let calls = 0;
  const client = createGooglePlacesNewClient({
    usage: {
      async reserve() {
        calls += 1;
        return 'reserved';
      },
    },
    fetch: async () => {
      calls += 1;
      return Response.json({ places: [] });
    },
  });
  const result = await client.searchText({ query: '銀座' });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

test('a successful empty Places response is no match, not provider failure', async () => {
  const client = createGooglePlacesNewClient({
    apiKey: 'fixture-secret',
    usage: {
      async reserve() {
        return 'reserved';
      },
    },
    fetch: async () => Response.json({}),
  });
  const result = await client.searchText({ query: 'unmatched place' });
  assert.deepEqual(result, {
    ok: true,
    value: { places: [], hasMore: false },
  });
});

function place(id, name, address) {
  return { id, displayName: { text: name }, formattedAddress: address };
}
