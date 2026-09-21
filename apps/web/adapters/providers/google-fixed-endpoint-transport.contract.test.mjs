import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGoogleFixedEndpointTransport,
  GOOGLE_FIXED_ENDPOINTS,
} from './google-fixed-endpoint-transport.ts';

const geocodeResult = {
  results: [
    {
      formatted_address: '東京都中央区銀座',
      geometry: { location: { lat: 35.6717, lng: 139.765 } },
    },
  ],
};

test('the fixed Google transport emits only the three D-P04 endpoint tuples', async () => {
  const requests = [];
  const transport = createGoogleFixedEndpointTransport({
    apiKey: 'test-google-key',
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify(geocodeResult), { status: 200 });
    },
  });

  const geocode = await transport.execute({
    kind: 'geocoding',
    query: { address: '銀座', region: 'jp', components: 'country:JP' },
    fields: ['formattedAddress', 'coordinates'],
  });
  const matrix = await transport.execute({
    kind: 'route_matrix',
    body: matrixBody(),
    fields: ['routeDurationSeconds', 'routeDistanceMeters'],
  });
  const routes = await transport.execute({
    kind: 'routes',
    body: routesBody('WALK'),
    fields: ['routeDurationSeconds', 'routeDistanceMeters'],
  });

  assert.equal(geocode.status, 200);
  assert.equal(matrix.status, 502);
  assert.equal(routes.status, 502);
  assert.deepEqual(
    requests.map(({ url, init }) => ({
      method: init.method,
      url: new URL(url).origin + new URL(url).pathname,
      redirect: init.redirect,
      apiKey: new Headers(init.headers).get('x-goog-api-key'),
    })),
    [
      {
        method: 'GET',
        url: GOOGLE_FIXED_ENDPOINTS.geocoding,
        redirect: 'manual',
        apiKey: 'test-google-key',
      },
      {
        method: 'POST',
        url: GOOGLE_FIXED_ENDPOINTS.routeMatrix,
        redirect: 'manual',
        apiKey: 'test-google-key',
      },
      {
        method: 'POST',
        url: GOOGLE_FIXED_ENDPOINTS.routes,
        redirect: 'manual',
        apiKey: 'test-google-key',
      },
    ],
  );
});

test('the fixed Google transport closes before fetch for malformed structured input or a missing key', async () => {
  let calls = 0;
  const transport = createGoogleFixedEndpointTransport({
    apiKey: '',
    fetch: async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    },
  });

  const missingKey = await transport.execute({
    kind: 'geocoding',
    query: { address: '銀座', region: 'jp', components: 'country:JP' },
    fields: ['formattedAddress', 'coordinates'],
  });
  const malformed = await createGoogleFixedEndpointTransport({
    apiKey: 'test-google-key',
    fetch: async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    },
  }).execute({
    kind: 'routes',
    body: { ...routesBody('WALK'), travelMode: 'DRIVE' },
    fields: ['routeDurationSeconds', 'routeDistanceMeters'],
  });

  assert.equal(missingKey.status, 503);
  assert.equal(malformed.status, 400);
  assert.equal(calls, 0);
});

test('the fixed Google transport rejects every redirect without a second fetch or raw response escape', async () => {
  let calls = 0;
  const transport = createGoogleFixedEndpointTransport({
    apiKey: 'test-google-key',
    fetch: async () => {
      calls += 1;
      return new Response('{"location":"https://not-allowed.example"}', {
        status: 302,
        headers: { location: 'https://not-allowed.example' },
      });
    },
  });

  const result = await transport.execute({
    kind: 'geocoding',
    query: { address: '銀座', region: 'jp', components: 'country:JP' },
    fields: ['formattedAddress', 'coordinates'],
  });

  assert.deepEqual(result, { status: 502, headers: {}, body: {} });
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /not-allowed|location/u);
});

function matrixBody() {
  return {
    origins: [waypoint(35.6717, 139.765)],
    destinations: [waypoint(35.672, 139.766)],
    travelMode: 'WALK',
    languageCode: 'ja',
    regionCode: 'JP',
    units: 'METRIC',
  };
}

function routesBody(travelMode) {
  return {
    origin: { location: { latLng: { latitude: 35.6717, longitude: 139.765 } } },
    destination: {
      location: { latLng: { latitude: 35.672, longitude: 139.766 } },
    },
    travelMode,
    languageCode: 'ja',
    units: 'METRIC',
  };
}

function waypoint(latitude, longitude) {
  return { waypoint: { location: { latLng: { latitude, longitude } } } };
}
