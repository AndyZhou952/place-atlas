import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCatalogIntakeCleanup } from './catalog-intake-maintenance.ts';
import { createOwnerPocWorker } from './owner-poc-worker.ts';

test('owner-poc scheduled runtime owns CatalogIntake cleanup and uses scheduled time', async () => {
  const database = { name: 'owner-poc-d1' };
  const calls = [];
  const cleanup = createCatalogIntakeCleanup({
    async cleanup(now) {
      calls.push(now.toISOString());
      return { expired: 1, removed: 0 };
    },
  });
  const worker = createOwnerPocWorker(
    { fetch: () => new Response('ok') },
    (receivedDatabase, now) => {
      assert.equal(receivedDatabase, database);
      return cleanup(now);
    },
  );
  const pending = [];
  worker.scheduled(
    { scheduledTime: Date.parse('2026-09-23T03:00:00.000Z') },
    { DB: database },
    { waitUntil: (promise) => pending.push(promise) },
  );
  await Promise.all(pending);
  assert.deepEqual(calls, ['2026-09-23T03:00:00.000Z']);
});

test('only owner-poc uses the daily cleanup wrapper while Agent keeps its existing entrypoint', async () => {
  const ownerConfig = JSON.parse(
    stripJsonComments(
      await readFile(
        new URL('../../../wrangler.owner-poc.jsonc', import.meta.url),
        'utf8',
      ),
    ),
  );
  const agentConfig = JSON.parse(
    stripJsonComments(
      await readFile(
        new URL('../../../wrangler.agent-poc.jsonc', import.meta.url),
        'utf8',
      ),
    ),
  );
  assert.equal(ownerConfig.main, 'owner-poc-worker.ts');
  assert.deepEqual(ownerConfig.triggers.crons, ['0 3 * * *']);
  assert.equal(agentConfig.main, 'vinext/server/fetch-handler');

  const entrypoint = await readFile(
    new URL('../../../owner-poc-worker.ts', import.meta.url),
    'utf8',
  );
  assert.match(entrypoint, /vinext\/server\/fetch-handler/u);
  assert.match(entrypoint, /runD1CatalogIntakeCleanup/u);
});

function stripJsonComments(value) {
  return value.replace(/^\s*\/\/.*$/gmu, '').replace(/,\s*([}\]])/gu, '$1');
}
