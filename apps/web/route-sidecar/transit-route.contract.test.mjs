import assert from 'node:assert/strict';
import test from 'node:test';

import { mapGoogleTransitRouteResponse } from '../adapters/providers/google-transit-route-response-mapper.ts';
import { createGoogleRouteSidecarService } from './route-sidecar-service.ts';
import { createMeteredRouteSidecarClient } from './metered-route-sidecar-client.ts';
import { createRouteSidecarNearbyAdapter } from './route-sidecar-nearby-adapter.ts';

const point = { latitude: 38.72, longitude: -9.14 };
const request = {
  origin: point,
  destination: { latitude: 38.73, longitude: -9.15 },
};
const step = (type, name = 'Metro') => ({
  travelMode: 'TRANSIT',
  transitDetails: { transitLine: { name, vehicle: { type } } },
});
const route = (steps, duration = '1100s') => ({
  duration,
  legs: [{ steps }],
});

test('transit mapper selects a direct rail alternative and includes access walking', () => {
  const mapped = mapGoogleTransitRouteResponse({
    routes: [
      route(
        [{ travelMode: 'WALK' }, step('BUS'), { travelMode: 'WALK' }],
        '800s',
      ),
      route([
        { travelMode: 'WALK' },
        step('SUBWAY', 'Line A'),
        { travelMode: 'WALK' },
      ]),
      route([step('TRAIN', 'Line B'), step('TRAIN', 'Line C')], '700s'),
    ],
  });
  assert.deepEqual(mapped, {
    directRoute: { durationSeconds: 1100, lineIdentity: 'Line A' },
  });
  assert.deepEqual(
    mapGoogleTransitRouteResponse({ routes: [route([step('BUS')])] }),
    { directRoute: null },
  );
  assert.deepEqual(mapGoogleTransitRouteResponse({ routes: [] }), {
    directRoute: null,
  });
  assert.deepEqual(mapGoogleTransitRouteResponse({}), { directRoute: null });
  assert.equal(mapGoogleTransitRouteResponse({ error: 'unknown' }), undefined);
  assert.equal(
    mapGoogleTransitRouteResponse({ routes: [route([step('SUBWAY')], 'bad')] }),
    undefined,
  );
});

test('transit sidecar uses one fixed endpoint and returns closed evidence', async () => {
  const requests = [];
  const sidecar = createGoogleRouteSidecarService({
    apiKey: 'test-only-key',
    clock: () => new Date('2026-09-30T00:00:00.000Z'),
    fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        routes: [route([{ travelMode: 'WALK' }, step('SUBWAY')])],
        secretProviderField: 'discard',
      });
    },
  });
  const evidence = await sidecar.transit(request);
  assert.equal(evidence.ok, true);
  assert.deepEqual(evidence.evidence.directRoute, {
    durationSeconds: 1100,
    lineIdentity: 'Metro',
  });
  assert.doesNotMatch(JSON.stringify(evidence), /secretProviderField/u);
  assert.equal(requests.length, 1);
  assert.equal(
    new URL(requests[0].url).pathname,
    '/directions/v2:computeRoutes',
  );
  assert.equal(requests[0].init.headers['x-goog-api-key'], 'test-only-key');
  const sent = JSON.parse(requests[0].init.body);
  assert.equal(sent.travelMode, 'TRANSIT');
  assert.equal(sent.computeAlternativeRoutes, true);
  assert.deepEqual(sent.origin.location.latLng, point);
  assert.deepEqual(sent.destination.location.latLng, request.destination);
  assert.equal('waypoint' in sent.origin, false);
  assert.equal(
    (await sidecar.transit({ ...request, origin: { ...point, latitude: 900 } }))
      .ok,
    false,
  );
  assert.equal(requests.length, 1);
});

test('transit adapter distinguishes a verified missing direct rail route from outage', async () => {
  const sidecar = {
    async transit() {
      return {
        ok: true,
        evidence: {
          directRoute: null,
          checkedAt: '2026-09-30T00:00:00.000Z',
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
        },
      };
    },
  };
  const adapter = createRouteSidecarNearbyAdapter(sidecar);
  assert.equal(
    (await adapter.transitRouteProvider.transit(point, request.destination))
      .status,
    'no_direct_route',
  );
  sidecar.transit = async () => ({ ok: false, error: 'quota_exceeded' });
  assert.equal(
    (await adapter.transitRouteProvider.transit(point, request.destination))
      .status,
    'unavailable',
  );
});

test('transit RPC reserves a bounded estimated budget before egress', async () => {
  const reservations = [];
  let calls = 0;
  const client = createMeteredRouteSidecarClient({
    usage: {
      async reserve(value) {
        reservations.push(value);
        return 'reserved';
      },
    },
    service: {
      async transit() {
        calls += 1;
        return { ok: true, evidence: { directRoute: null } };
      },
    },
  });
  await client.transit(request);
  assert.equal(calls, 1);
  assert.equal(reservations[0].sku, 'transit_routes.requests');
  assert.equal(reservations[0].hardRequestLimit, 250);
  assert.equal(reservations[0].costUsd, 0.02);
  await client.transit({
    ...request,
    destination: { ...point, longitude: 200 },
  });
  assert.equal(calls, 1);
});

test('Japan transit requests fail before route-provider egress or quota reservation', async () => {
  let calls = 0;
  let reservations = 0;
  const japanRequest = {
    origin: { latitude: 35.67, longitude: 139.76 },
    destination: { latitude: 35.69, longitude: 139.71 },
  };
  const sidecar = createGoogleRouteSidecarService({
    apiKey: 'test-only-key',
    clock: () => new Date('2026-09-30T00:00:00.000Z'),
    fetch: async () => {
      calls += 1;
      return Response.json({});
    },
  });
  const client = createMeteredRouteSidecarClient({
    usage: {
      async reserve() {
        reservations += 1;
        return 'reserved';
      },
    },
    service: sidecar,
  });
  assert.deepEqual(await sidecar.transit(japanRequest), {
    ok: false,
    error: 'unsupported_region',
  });
  assert.deepEqual(await client.transit(japanRequest), {
    ok: false,
    error: 'unsupported_region',
  });
  assert.equal(calls, 0);
  assert.equal(reservations, 0);
});
