import assert from 'node:assert/strict';
import test from 'node:test';

import { createAllowlistedNearbyDiagnosticRecorder } from './nearby-diagnostic-recorder.ts';
import { createGoogleRouteSidecarService } from './route-sidecar-service.ts';
import { createMeteredRouteSidecarClient } from './metered-route-sidecar-client.ts';
import { createRouteSidecarNearbyAdapter } from './route-sidecar-nearby-adapter.ts';

test('missing Sidecar secret records only an allowlisted failure class', async () => {
  const diagnostics = [];
  const service = createGoogleRouteSidecarService({
    apiKey: undefined,
    clock: () => new Date('2026-09-24T00:00:00.000Z'),
    fetch: async () => {
      throw new Error('must not fetch');
    },
    diagnosticRecorder: createAllowlistedNearbyDiagnosticRecorder((event) => {
      diagnostics.push(event);
    }),
  });

  const result = await service.geocode({ locationHint: 'PRIVATE-QUERY-池袋' });

  assert.deepEqual(result, { ok: false, error: 'not_configured' });
  assert.deepEqual(diagnostics, [
    {
      layer: 'sidecar_transport',
      operation: 'geocoding',
      endpoint: 'geocoding',
      resultClass: 'not_configured',
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /PRIVATE-QUERY|latitude|longitude|key|raw|body|owner|catalog/iu,
  );
});

test('successful geocoding and walking matrix calls record only closed endpoint outcomes', async () => {
  const diagnostics = [];
  const service = createGoogleRouteSidecarService({
    apiKey: 'PRIVATE-KEY',
    clock: () => new Date('2026-09-24T00:00:00.000Z'),
    fetch: async (url) =>
      String(url).includes('/geocode/')
        ? Response.json({
            status: 'OK',
            results: [
              {
                formatted_address: 'PRIVATE-ADDRESS',
                geometry: { location: { lat: 35.7, lng: 139.7 } },
              },
            ],
          })
        : Response.json([
            {
              originIndex: 0,
              destinationIndex: 0,
              status: {},
              condition: 'ROUTE_EXISTS',
              distanceMeters: 300,
              duration: '240s',
            },
          ]),
    diagnosticRecorder: createAllowlistedNearbyDiagnosticRecorder((event) => {
      diagnostics.push(event);
    }),
  });

  assert.equal(
    (await service.geocode({ locationHint: 'PRIVATE-QUERY' })).ok,
    true,
  );
  assert.equal(
    (
      await service.walkingMatrix({
        origin: { latitude: 35.7, longitude: 139.7 },
        destinations: [{ latitude: 35.71, longitude: 139.71 }],
      })
    ).ok,
    true,
  );

  assert.deepEqual(diagnostics, [
    {
      layer: 'sidecar_transport',
      operation: 'geocoding',
      endpoint: 'geocoding',
      resultClass: 'success',
      httpClass: '2xx',
    },
    {
      layer: 'sidecar_transport',
      operation: 'walking_matrix',
      endpoint: 'walking_matrix',
      resultClass: 'success',
      httpClass: '2xx',
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /PRIVATE|query|address|latitude|longitude|coordinates|catalog|provider|body|secret/iu,
  );
});

test('ordinary upstream 4xx failures stay dependency failures for both operations and expose only HTTP class', async () => {
  const diagnostics = [];
  const service = createGoogleRouteSidecarService({
    apiKey: 'PRIVATE-KEY',
    clock: () => new Date('2026-09-24T00:00:00.000Z'),
    fetch: async () =>
      Response.json(
        { error: { message: 'PRIVATE-PROVIDER-BODY' } },
        { status: 429 },
      ),
    diagnosticRecorder: createAllowlistedNearbyDiagnosticRecorder((event) => {
      diagnostics.push(event);
    }),
  });

  assert.deepEqual(await service.geocode({ locationHint: 'PRIVATE-QUERY' }), {
    ok: false,
    error: 'dependency_failure',
  });
  assert.deepEqual(
    await service.walkingMatrix({
      origin: { latitude: 35.7, longitude: 139.7 },
      destinations: [{ latitude: 35.71, longitude: 139.71 }],
    }),
    { ok: false, error: 'dependency_failure' },
  );
  assert.deepEqual(diagnostics, [
    {
      layer: 'sidecar_transport',
      operation: 'geocoding',
      endpoint: 'geocoding',
      resultClass: 'upstream_unavailable',
      httpClass: '4xx',
    },
    {
      layer: 'sidecar_transport',
      operation: 'walking_matrix',
      endpoint: 'walking_matrix',
      resultClass: 'upstream_unavailable',
      httpClass: '4xx',
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /PRIVATE|query|latitude|longitude|coordinates|catalog|provider|body|secret/iu,
  );
});

test('one successful Nearby route records only reserved and provider success facts across both layers', async () => {
  const diagnostics = [];
  const recorder = createAllowlistedNearbyDiagnosticRecorder((event) => {
    diagnostics.push(event);
  });
  const sidecar = createGoogleRouteSidecarService({
    apiKey: 'PRIVATE-KEY',
    clock: () => new Date('2026-09-24T00:00:00.000Z'),
    fetch: async (url) =>
      String(url).includes('/geocode/')
        ? Response.json({
            status: 'OK',
            results: [
              {
                formatted_address: 'PRIVATE-ADDRESS',
                geometry: { location: { lat: 35.7, lng: 139.7 } },
              },
            ],
          })
        : Response.json([
            {
              originIndex: 0,
              destinationIndex: 0,
              status: {},
              condition: 'ROUTE_EXISTS',
              distanceMeters: 300,
              duration: '240s',
            },
          ]),
    diagnosticRecorder: recorder,
  });
  const metered = createMeteredRouteSidecarClient({
    service: sidecar,
    usage: {
      async reserve() {
        return 'reserved';
      },
    },
    diagnosticRecorder: recorder,
  });
  const nearby = createRouteSidecarNearbyAdapter(metered);

  const location = await nearby.locationResolver.resolve('PRIVATE-QUERY');
  assert.equal(location.status, 'resolved');
  const route = await nearby.routeProvider.walking(
    { latitude: 35.7, longitude: 139.7 },
    { latitude: 35.71, longitude: 139.71 },
  );
  assert.equal(route.status, 'fresh');

  assert.deepEqual(diagnostics, [
    {
      layer: 'owner_metering',
      operation: 'geocoding',
      endpoint: 'route_sidecar_binding',
      sku: 'geocoding.requests',
      resultClass: 'reserved',
      quotaDecision: 'reserved',
    },
    {
      layer: 'sidecar_transport',
      operation: 'geocoding',
      endpoint: 'geocoding',
      resultClass: 'success',
      httpClass: '2xx',
    },
    {
      layer: 'owner_metering',
      operation: 'walking_matrix',
      endpoint: 'route_sidecar_binding',
      sku: 'walking_matrix.elements',
      resultClass: 'reserved',
      quotaDecision: 'reserved',
    },
    {
      layer: 'sidecar_transport',
      operation: 'walking_matrix',
      endpoint: 'walking_matrix',
      resultClass: 'success',
      httpClass: '2xx',
    },
  ]);
  const allowedKeys = new Set([
    'layer',
    'operation',
    'endpoint',
    'sku',
    'quotaDecision',
    'resultClass',
    'httpClass',
  ]);
  assert.equal(
    diagnostics.every((event) =>
      Object.keys(event).every((key) => allowedKeys.has(key)),
    ),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /PRIVATE|query|address|latitude|longitude|coordinates|catalog|provider|body|secret/iu,
  );
});

test('Sidecar closes provider, transport, redirect, HTTP, malformed, and zero-result outcomes without retry or leak', async (t) => {
  const cases = [
    {
      name: 'API restriction denied',
      response: () =>
        Response.json({
          status: 'REQUEST_DENIED',
          results: [],
          error_message: 'PRIVATE-PROVIDER-BODY',
        }),
      result: { ok: false, error: 'dependency_failure' },
      diagnostic: {
        layer: 'sidecar_transport',
        operation: 'geocoding',
        endpoint: 'geocoding',
        resultClass: 'credential_rejected',
      },
    },
    {
      name: 'DNS or fetch failure',
      response: () => {
        throw new Error('PRIVATE-DNS-DETAIL');
      },
      result: { ok: false, error: 'dependency_failure' },
      diagnostic: {
        layer: 'sidecar_transport',
        operation: 'geocoding',
        endpoint: 'geocoding',
        resultClass: 'transport_unavailable',
      },
    },
    {
      name: 'redirect',
      response: () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://PRIVATE-REDIRECT.invalid' },
        }),
      result: { ok: false, error: 'dependency_failure' },
      diagnostic: {
        layer: 'sidecar_transport',
        operation: 'geocoding',
        endpoint: 'geocoding',
        resultClass: 'transport_unavailable',
        httpClass: '3xx',
      },
    },
    {
      name: 'upstream 5xx',
      response: () =>
        Response.json(
          { private_body: 'PRIVATE-PROVIDER-BODY' },
          { status: 503 },
        ),
      result: { ok: false, error: 'dependency_failure' },
      diagnostic: {
        layer: 'sidecar_transport',
        operation: 'geocoding',
        endpoint: 'geocoding',
        resultClass: 'upstream_unavailable',
        httpClass: '5xx',
      },
    },
    {
      name: 'malformed JSON',
      response: () => new Response('{PRIVATE-MALFORMED', { status: 200 }),
      result: { ok: false, error: 'dependency_failure' },
      diagnostic: {
        layer: 'sidecar_transport',
        operation: 'geocoding',
        endpoint: 'geocoding',
        resultClass: 'malformed_response',
      },
    },
    {
      name: 'malformed payload',
      response: () => Response.json({ private_body: 'PRIVATE-PROVIDER-BODY' }),
      result: { ok: false, error: 'dependency_failure' },
      diagnostic: {
        layer: 'sidecar_transport',
        operation: 'geocoding',
        endpoint: 'geocoding',
        resultClass: 'malformed_response',
      },
    },
    {
      name: 'normal zero results',
      response: () => Response.json({ status: 'ZERO_RESULTS', results: [] }),
      result: {
        ok: true,
        evidence: {
          candidates: [],
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
          source: {
            providerId: 'google-maps-platform',
            endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
          },
          checkedAt: '2026-09-24T00:00:00.000Z',
        },
      },
      diagnostic: {
        layer: 'sidecar_transport',
        operation: 'geocoding',
        endpoint: 'geocoding',
        resultClass: 'not_found',
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const diagnostics = [];
      let calls = 0;
      const service = createGoogleRouteSidecarService({
        apiKey: 'PRIVATE-KEY',
        clock: () => new Date('2026-09-24T00:00:00.000Z'),
        fetch: async () => {
          calls += 1;
          return fixture.response();
        },
        diagnosticRecorder: createAllowlistedNearbyDiagnosticRecorder((event) =>
          diagnostics.push(event),
        ),
      });

      assert.deepEqual(
        await service.geocode({ locationHint: 'PRIVATE-QUERY-池袋' }),
        fixture.result,
      );
      assert.equal(calls, 1, 'provider egress must never auto-retry');
      assert.deepEqual(diagnostics, [fixture.diagnostic]);
      assert.doesNotMatch(
        JSON.stringify({ result: fixture.result, diagnostics }),
        /PRIVATE|latitude|longitude|key|raw|body|owner|catalog/iu,
      );
    });
  }
});
