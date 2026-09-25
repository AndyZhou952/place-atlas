import assert from 'node:assert/strict';
import test from 'node:test';

import { createMeteredRouteSidecarClient } from './metered-route-sidecar-client.ts';
import { createAllowlistedNearbyDiagnosticRecorder } from './nearby-diagnostic-recorder.ts';

test('Owner metering owns binding-missing and quota classes without leaking input', async () => {
  const diagnostics = [];
  let reservations = 0;
  const client = createMeteredRouteSidecarClient({
    service: undefined,
    usage: {
      async reserve() {
        reservations += 1;
        return 'reserved';
      },
    },
    diagnosticRecorder: createAllowlistedNearbyDiagnosticRecorder((event) => {
      diagnostics.push(event);
    }),
  });

  assert.deepEqual(
    await client.geocode({ locationHint: 'PRIVATE-QUERY-池袋' }),
    { ok: false, error: 'not_configured' },
  );
  assert.equal(reservations, 0);
  assert.deepEqual(diagnostics, [
    {
      layer: 'owner_metering',
      operation: 'geocoding',
      endpoint: 'route_sidecar_binding',
      sku: 'geocoding.requests',
      resultClass: 'binding_missing',
      quotaDecision: 'not_checked',
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /PRIVATE|locationHint|池袋|key/iu,
  );
});

test('each explicit retry makes a new atomic reservation and provider failures never refund it', async () => {
  const diagnostics = [];
  const events = [];
  let reservedUnits = 0;
  const client = createMeteredRouteSidecarClient({
    service: {
      async geocode() {
        events.push('rpc');
        return { ok: false, error: 'dependency_failure' };
      },
      async walkingMatrix() {
        throw new Error('not used');
      },
    },
    usage: {
      async reserve(input) {
        events.push('reserve');
        reservedUnits += input.units;
        return reservedUnits <= 2 ? 'reserved' : 'quota_exceeded';
      },
    },
    diagnosticRecorder: createAllowlistedNearbyDiagnosticRecorder((event) => {
      diagnostics.push(event);
    }),
  });

  assert.deepEqual(await client.geocode({ locationHint: '池袋' }), {
    ok: false,
    error: 'dependency_failure',
  });
  assert.deepEqual(await client.geocode({ locationHint: '池袋' }), {
    ok: false,
    error: 'dependency_failure',
  });
  assert.deepEqual(await client.geocode({ locationHint: '池袋' }), {
    ok: false,
    error: 'quota_exceeded',
  });
  assert.deepEqual(events, ['reserve', 'rpc', 'reserve', 'rpc', 'reserve']);
  assert.equal(reservedUnits, 3, 'failed calls remain charged');
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
      layer: 'owner_metering',
      operation: 'geocoding',
      endpoint: 'route_sidecar_binding',
      sku: 'geocoding.requests',
      resultClass: 'reserved',
      quotaDecision: 'reserved',
    },
    {
      layer: 'owner_metering',
      operation: 'geocoding',
      endpoint: 'route_sidecar_binding',
      sku: 'geocoding.requests',
      resultClass: 'quota_exhausted',
      quotaDecision: 'rejected',
    },
  ]);
});

test('successful geocoding and walking reservations record only allowlisted operational facts', async () => {
  const diagnostics = [];
  const client = createMeteredRouteSidecarClient({
    service: {
      async geocode() {
        return {
          ok: true,
          evidence: {
            candidates: [],
            attribution: {
              label: 'Google Maps',
              url: 'https://www.google.com/maps',
            },
            source: {
              providerId: 'google-maps-platform',
              endpoint: 'PRIVATE-PROVIDER-ENDPOINT',
            },
            checkedAt: '2026-09-24T00:00:00.000Z',
          },
        };
      },
      async walkingMatrix() {
        return {
          ok: true,
          evidence: {
            routes: [
              {
                destinationIndex: 0,
                durationSeconds: 240,
                distanceMeters: 300,
              },
            ],
            attribution: {
              label: 'Google Maps',
              url: 'https://www.google.com/maps',
            },
            source: {
              providerId: 'google-maps-platform',
              endpoint: 'PRIVATE-PROVIDER-ENDPOINT',
            },
            checkedAt: '2026-09-24T00:00:01.000Z',
          },
        };
      },
    },
    usage: {
      async reserve() {
        return 'reserved';
      },
    },
    diagnosticRecorder: createAllowlistedNearbyDiagnosticRecorder((event) => {
      diagnostics.push(event);
    }),
  });

  await client.geocode({ locationHint: 'PRIVATE-QUERY' });
  await client.walkingMatrix({
    origin: { latitude: 35.7, longitude: 139.7 },
    destinations: [{ latitude: 35.71, longitude: 139.71 }],
  });

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
      layer: 'owner_metering',
      operation: 'walking_matrix',
      endpoint: 'route_sidecar_binding',
      sku: 'walking_matrix.elements',
      resultClass: 'reserved',
      quotaDecision: 'reserved',
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /PRIVATE|query|latitude|longitude|coordinates|catalog|provider|body|secret/iu,
  );
});
