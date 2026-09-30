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

void test('the Sidecar source graph contains only the approved Google route capabilities', async () => {
  const source = `${await readFile(serviceUrl, 'utf8')}\n${await readFile(transportUrl, 'utf8')}`;
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
