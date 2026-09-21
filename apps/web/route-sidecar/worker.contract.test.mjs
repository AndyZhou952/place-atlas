import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const configUrl = new URL('../wrangler.route-sidecar.jsonc', import.meta.url);
const workerUrl = new URL('./worker.ts', import.meta.url);

void test('route sidecar has no public route, workers.dev, preview URL, or owner capability', async () => {
  const source = await readFile(configUrl, 'utf8');
  const config = JSON.parse(source.replace(/,\s*([}\]])/gu, '$1'));

  assert.equal(config.name, 'japan-atlas-route-sidecar');
  assert.equal(config.main, 'route-sidecar/worker.ts');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  for (const binding of [
    'vars',
    'd1_databases',
    'r2_buckets',
    'services',
    'kv_namespaces',
    'queues',
    'durable_objects',
  ]) {
    assert.equal(config[binding], undefined, `${binding} must remain absent`);
  }
  assert.doesNotMatch(
    source,
    /ATLAS_OWNER|AGENT_JPMAP|HMAC|FOURSQUARE|TRANSIT|database_id|bucket_name/iu,
  );
});

void test('the RPC entrypoint fails closed if HTTP is accidentally routed', async () => {
  const source = await readFile(workerUrl, 'utf8');

  assert.match(source, /extends WorkerEntrypoint<RouteSidecarEnv>/u);
  assert.match(
    source,
    /fetch\(\): Response \{\s*return new Response\(null, \{ status: 404 \}\);/u,
  );
  assert.doesNotMatch(source, /console\.|request\.json|request\.text/iu);
});
