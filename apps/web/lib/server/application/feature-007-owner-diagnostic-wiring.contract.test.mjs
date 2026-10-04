import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const compositionUrl = new URL('./owner-poc-composition.ts', import.meta.url);

void test('Owner production composition injects a non-persisting Nearby diagnostic recorder', async () => {
  const source = await readFile(compositionUrl, 'utf8');

  assert.match(source, /createOperationalNearbyDiagnosticRecorder/u);
  assert.match(
    source,
    /createD1MeteredRouteSidecarClient\(\{[\s\S]*?diagnosticRecorder:\s*createOperationalNearbyDiagnosticRecorder\(\)[\s\S]*?\}\)/u,
  );
  assert.doesNotMatch(
    source,
    /console\.|\.prepare\([^)]*diagnostic|MEDIA|R2|put\(/u,
  );
});
