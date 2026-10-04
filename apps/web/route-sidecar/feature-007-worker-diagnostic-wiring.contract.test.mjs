import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createAllowlistedNearbyDiagnosticRecorder } from './nearby-diagnostic-recorder.ts';

test('diagnostic recorder strips poison fields and cannot change a product call', () => {
  const recorded = [];
  const recorder = createAllowlistedNearbyDiagnosticRecorder((event) => {
    recorded.push(event);
  });

  assert.doesNotThrow(() =>
    recorder.record({
      layer: 'sidecar_transport',
      operation: 'geocoding',
      endpoint: 'geocoding',
      resultClass: 'credential_rejected',
      httpClass: '4xx',
      locationHint: 'PRIVATE-QUERY-池袋',
      key: 'PRIVATE-KEY',
      coordinates: [35.7295, 139.7109],
      body: 'PRIVATE-PROVIDER-BODY',
    }),
  );
  assert.deepEqual(recorded, [
    {
      layer: 'sidecar_transport',
      operation: 'geocoding',
      endpoint: 'geocoding',
      resultClass: 'credential_rejected',
      httpClass: '4xx',
    },
  ]);

  const failingSink = createAllowlistedNearbyDiagnosticRecorder(() => {
    throw new Error('diagnostic sink unavailable');
  });
  assert.doesNotThrow(() =>
    failingSink.record({
      layer: 'sidecar_transport',
      operation: 'geocoding',
      endpoint: 'geocoding',
      resultClass: 'transport_unavailable',
    }),
  );
});

test('Sidecar worker production service wires the operational allowlisted recorder', async () => {
  const source = await readFile(
    new URL('./worker.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /createOperationalNearbyDiagnosticRecorder/u);
  assert.match(
    source,
    /createGoogleRouteSidecarService\(\{[\s\S]*?diagnosticRecorder:\s*createOperationalNearbyDiagnosticRecorder\(\)/u,
  );
  assert.doesNotMatch(source, /locationHint.*console|apiKey.*console/iu);
});
