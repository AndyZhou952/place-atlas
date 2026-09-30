import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { inspectRouteSidecarBundle } from './route-sidecar-bundle-preflight.ts';

const serviceUrl = new URL(
  '../route-sidecar/route-sidecar-service.ts',
  import.meta.url,
);
const transportUrl = new URL(
  '../route-sidecar/google-route-sidecar-transport.ts',
  import.meta.url,
);
const navitimeTransportUrl = new URL(
  '../route-sidecar/navitime-transit-transport.ts',
  import.meta.url,
);
const regionalServiceUrl = new URL(
  '../route-sidecar/regional-transit-service.ts',
  import.meta.url,
);

void test('the Sidecar source graph contains only approved route capabilities', async () => {
  const source = (
    await Promise.all(
      [serviceUrl, transportUrl, navitimeTransportUrl, regionalServiceUrl].map(
        (url) => readFile(url, 'utf8'),
      ),
    )
  ).join('\n');
  assert.doesNotMatch(source, /foursquare|google-fixed-endpoint-transport/iu);
  assert.deepEqual(inspectRouteSidecarBundle(source), {
    ready: true,
    blockers: [],
  });
});

void test('bundle preflight rejects unapproved providers and unexpected endpoints', () => {
  const base = [
    'https://maps.googleapis.com/maps/api/geocode/json',
    'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    'https://www.google.com/maps',
    'https://navitime-route-totalnavi.p.rapidapi.com/route_transit',
    'https://www.navitime.co.jp/',
  ].join('\n');
  for (const forbidden of [
    'Foursquare',
    'google-fixed-endpoint-transport',
    'https://example.com/unexpected',
  ]) {
    assert.equal(
      inspectRouteSidecarBundle(`${base}\n${forbidden}`).ready,
      false,
    );
  }
});
