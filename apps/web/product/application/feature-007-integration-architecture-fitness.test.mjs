import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const applicationSurface = [
  new URL('./catalog-intake/catalog-intake-coordinator.ts', import.meta.url),
  new URL('./conversation/project-command-router.ts', import.meta.url),
  new URL('./conversation/wechat-catalog-intake-presenter.ts', import.meta.url),
  new URL('./decision/nearby-recommendation-operation.ts', import.meta.url),
  new URL('../../features/atlas/atlas-screen.tsx', import.meta.url),
];

void test('Feature 007 keeps private Nearby diagnostic classes outside product and presenter surfaces', async () => {
  const source = (
    await Promise.all(applicationSurface.map((url) => readFile(url, 'utf8')))
  ).join('\n');

  assert.doesNotMatch(
    source,
    /credential_rejected|transport_unavailable|upstream_unavailable|malformed_response|binding_missing|quota_exhausted/u,
  );
  assert.doesNotMatch(source, /NearbyDiagnosticRecorder/u);
});

void test('Feature 007 production composition keeps the private service binding and diagnostic sink explicit', async () => {
  const [
    composition,
    diagnosticRecorder,
    db,
    r2Store,
    browserComposition,
    agentRoute,
    workerConfig,
  ] = await Promise.all([
    readFile(
      new URL(
        '../../lib/server/application/owner-poc-composition.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../../route-sidecar/nearby-diagnostic-recorder.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(new URL('../../db/index.ts', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../../lib/server/application/media/r2-media-object-store.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../../lib/server/application/server-atlas-application.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL('../../app/api/agent/v1/tools/route.ts', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../wrangler.owner-poc.jsonc', import.meta.url),
      'utf8',
    ),
  ]);

  assert.match(
    composition,
    /diagnosticRecorder:\s*createOperationalNearbyDiagnosticRecorder\(\)/u,
  );
  assert.doesNotMatch(composition, /noOpNearbyDiagnosticRecorder/u);
  assert.match(
    diagnosticRecorder,
    /createOperationalNearbyDiagnosticRecorder\(\)[\s\S]*?createAllowlistedNearbyDiagnosticRecorder\(\(event\) => \{[\s\S]*?console\.info\('nearby_diagnostic', event\)/u,
  );
  assert.deepEqual(diagnosticRecorder.match(/console\.\w+\(/gu), [
    'console.info(',
  ]);
  assert.doesNotMatch(
    diagnosticRecorder,
    /D1Database|R2Bucket|\.prepare\(|\.put\(/u,
  );
  assert.match(db, /return env\.ROUTE_SIDECAR/u);
  assert.match(browserComposition, /getRouteSidecarServiceBinding\(\)/u);
  assert.match(agentRoute, /bindings\.ROUTE_SIDECAR/u);
  assert.match(
    workerConfig,
    /"binding"\s*:\s*"ROUTE_SIDECAR"[\s\S]*?"service"\s*:\s*"japan-atlas-route-sidecar"/u,
  );
  const ownerAgentBranch = agentRoute.match(
    /if \(deployment\.ATLAS_DEPLOYMENT_ENV === 'owner-poc'\)([\s\S]*?)\n  \}/u,
  )?.[1];
  assert.ok(ownerAgentBranch);
  assert.doesNotMatch(
    `${composition}\n${db}\n${r2Store}\n${browserComposition}\n${ownerAgentBranch}`,
    /GOOGLE_MAPS_API_KEY/u,
  );
  assert.doesNotMatch(
    `${db}\n${r2Store}\n${browserComposition}\n${ownerAgentBranch}`,
    /nearby_diagnostic|credential_rejected|transport_unavailable|upstream_unavailable|malformed_response|binding_missing|quota_exhausted/u,
  );
});
