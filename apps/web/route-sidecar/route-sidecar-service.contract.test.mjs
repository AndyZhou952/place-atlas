import assert from 'node:assert/strict';
import test from 'node:test';

import { createGoogleRouteSidecarService } from './route-sidecar-service.ts';

test('geocode returns only closed Google evidence from the fixed endpoint', async () => {
  const requests = [];
  const service = createGoogleRouteSidecarService({
    apiKey: 'test-only-key',
    clock: () => new Date('2026-09-21T09:00:00.000Z'),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({
        results: [
          {
            formatted_address: '東京都中央区銀座',
            geometry: { location: { lat: 35.6717, lng: 139.765 } },
            provider_internal_id: 'must-not-escape',
          },
        ],
        status: 'OK',
        debug: { raw: 'must-not-escape' },
      });
    },
  });

  const result = await service.geocode({ locationHint: '銀座' });

  assert.deepEqual(result, {
    ok: true,
    evidence: {
      candidates: [
        {
          formattedAddress: '東京都中央区銀座',
          point: { latitude: 35.6717, longitude: 139.765 },
        },
      ],
      attribution: {
        label: 'Google Maps',
        url: 'https://www.google.com/maps',
      },
      source: {
        providerId: 'google-maps-platform',
        endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
      },
      checkedAt: '2026-09-21T09:00:00.000Z',
    },
  });
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(
    `${requestUrl.origin}${requestUrl.pathname}`,
    'https://maps.googleapis.com/maps/api/geocode/json',
  );
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.redirect, 'manual');
  assert.doesNotMatch(
    JSON.stringify(result),
    /provider_internal_id|debug|raw/u,
  );
});

test('geocode treats a Google configuration rejection as dependency failure instead of not found', async () => {
  const service = createGoogleRouteSidecarService({
    apiKey: 'test-only-key',
    clock: () => new Date('2026-09-21T09:00:00.000Z'),
    fetch: async () =>
      Response.json({
        results: [],
        status: 'REQUEST_DENIED',
        error_message: 'private provider configuration detail',
      }),
  });

  const result = await service.geocode({
    locationHint: '東京都中央区銀座4丁目',
  });

  assert.deepEqual(result, { ok: false, error: 'dependency_failure' });
  assert.doesNotMatch(
    JSON.stringify(result),
    /private|provider|configuration/u,
  );
});

test('fixed Google transport uses the credential style required by each API generation', async () => {
  const requests = [];
  const service = createGoogleRouteSidecarService({
    apiKey: 'test-only-key',
    clock: () => new Date('2026-09-21T09:00:00.000Z'),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return String(url).startsWith('https://maps.googleapis.com/')
        ? Response.json({
            results: [
              {
                formatted_address: '東京都中央区銀座4丁目',
                geometry: { location: { lat: 35.6717, lng: 139.765 } },
              },
            ],
            status: 'OK',
          })
        : Response.json([
            {
              originIndex: 0,
              destinationIndex: 0,
              status: {},
              condition: 'ROUTE_EXISTS',
              distanceMeters: 640,
              duration: '481s',
            },
          ]);
    },
  });

  await service.geocode({ locationHint: '東京都中央区銀座4丁目' });
  await service.walkingMatrix({
    origin: { latitude: 35.6717, longitude: 139.765 },
    destinations: [{ latitude: 35.672, longitude: 139.766 }],
  });

  const geocodeUrl = new URL(requests[0].url);
  const geocodeHeaders = new Headers(requests[0].init.headers);
  assert.equal(geocodeUrl.searchParams.get('key'), 'test-only-key');
  assert.equal(geocodeHeaders.has('x-goog-api-key'), false);
  const routesHeaders = new Headers(requests[1].init.headers);
  assert.equal(routesHeaders.get('x-goog-api-key'), 'test-only-key');
});

test('walkingMatrix returns ordered closed evidence for walking only', async () => {
  const requests = [];
  const service = createGoogleRouteSidecarService({
    apiKey: 'test-only-key',
    clock: () => new Date('2026-09-21T09:01:00.000Z'),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json([
        {
          originIndex: 0,
          destinationIndex: 0,
          status: {},
          condition: 'ROUTE_EXISTS',
          distanceMeters: 640,
          duration: '481.2s',
          provider_internal_id: 'must-not-escape',
        },
        {
          originIndex: 0,
          destinationIndex: 1,
          status: { code: 5 },
          condition: 'ROUTE_NOT_FOUND',
        },
      ]);
    },
  });

  const result = await service.walkingMatrix({
    origin: { latitude: 35.6717, longitude: 139.765 },
    destinations: [
      { latitude: 35.672, longitude: 139.766 },
      { latitude: 35.68, longitude: 139.77 },
    ],
  });

  assert.deepEqual(result, {
    ok: true,
    evidence: {
      routes: [
        { destinationIndex: 0, durationSeconds: 482, distanceMeters: 640 },
        { destinationIndex: 1, durationSeconds: null, distanceMeters: null },
      ],
      attribution: {
        label: 'Google Maps',
        url: 'https://www.google.com/maps',
      },
      source: {
        providerId: 'google-maps-platform',
        endpoint:
          'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
      },
      checkedAt: '2026-09-21T09:01:00.000Z',
    },
  });
  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(
    `${requestUrl.origin}${requestUrl.pathname}`,
    'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
  );
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.redirect, 'manual');
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    origins: [
      {
        waypoint: {
          location: {
            latLng: { latitude: 35.6717, longitude: 139.765 },
          },
        },
      },
    ],
    destinations: [
      {
        waypoint: {
          location: {
            latLng: { latitude: 35.672, longitude: 139.766 },
          },
        },
      },
      {
        waypoint: {
          location: {
            latLng: { latitude: 35.68, longitude: 139.77 },
          },
        },
      },
    ],
    travelMode: 'WALK',
    languageCode: 'ja',
    regionCode: 'JP',
    units: 'METRIC',
  });
  assert.doesNotMatch(JSON.stringify(result), /provider_internal_id|raw/u);
});

test('walkingMatrix rejects malformed or oversized input before Google egress', async () => {
  let calls = 0;
  const service = createGoogleRouteSidecarService({
    apiKey: 'test-only-key',
    clock: () => new Date('2026-09-21T09:01:00.000Z'),
    fetch: async () => {
      calls += 1;
      return Response.json([]);
    },
  });

  assert.deepEqual(
    await service.walkingMatrix({
      origin: { latitude: 35.6717, longitude: 139.765 },
      destinations: Array.from({ length: 26 }, () => ({
        latitude: 35.672,
        longitude: 139.766,
      })),
    }),
    { ok: false, error: 'invalid_request' },
  );
  assert.deepEqual(
    await service.walkingMatrix({
      origin: { latitude: 35.6717, longitude: 139.765 },
      destinations: [{ latitude: 35.672, longitude: 139.766 }],
      travelMode: 'TRANSIT',
    }),
    { ok: false, error: 'invalid_request' },
  );
  assert.equal(calls, 0);
});

test('missing Google secret fails closed before either fixed endpoint is fetched', async () => {
  let calls = 0;
  const service = createGoogleRouteSidecarService({
    apiKey: undefined,
    clock: () => new Date('2026-09-21T09:01:00.000Z'),
    fetch: async () => {
      calls += 1;
      return Response.json({});
    },
  });

  assert.deepEqual(await service.geocode({ locationHint: '銀座' }), {
    ok: false,
    error: 'not_configured',
  });
  assert.deepEqual(
    await service.walkingMatrix({
      origin: { latitude: 35.6717, longitude: 139.765 },
      destinations: [{ latitude: 35.672, longitude: 139.766 }],
    }),
    { ok: false, error: 'not_configured' },
  );
  assert.equal(calls, 0);
});

test('every redirect status fails closed without following either fixed method tuple', async () => {
  for (const status of [300, 301, 302, 303, 307, 308]) {
    const requests = [];
    const service = createGoogleRouteSidecarService({
      apiKey: 'test-only-key',
      clock: () => new Date('2026-09-21T09:01:00.000Z'),
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return new Response(null, {
          status,
          headers: { location: 'https://example.com/must-not-follow' },
        });
      },
    });

    assert.deepEqual(await service.geocode({ locationHint: '銀座' }), {
      ok: false,
      error: 'dependency_failure',
    });
    assert.deepEqual(
      await service.walkingMatrix({
        origin: { latitude: 35.6717, longitude: 139.765 },
        destinations: [{ latitude: 35.672, longitude: 139.766 }],
      }),
      { ok: false, error: 'dependency_failure' },
    );
    assert.equal(requests.length, 2);
    assert.deepEqual(
      requests.map(({ url, init }) => ({
        endpoint: `${new URL(url).origin}${new URL(url).pathname}`,
        method: init.method,
        redirect: init.redirect,
      })),
      [
        {
          endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
          method: 'GET',
          redirect: 'manual',
        },
        {
          endpoint:
            'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
          method: 'POST',
          redirect: 'manual',
        },
      ],
    );
  }
});
