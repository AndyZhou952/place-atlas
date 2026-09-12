import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createImportJobOperationGroup } from '../../../product/application/import-jobs/import-job-operations.ts';
import { D1ImportJobState } from './d1-import-job-state.ts';

const dependencies = {
  clock: { now: () => '2026-09-12T00:00:00.000Z' },
  idSource: { nextId: () => 'unused-job-id' },
};

const job = {
  id: 'job-newer',
  sourceRef: 'https://example.com/newer',
  creatorName: 'Newer source',
  platform: 'Web',
  status: 'queued',
  discoveredCount: 0,
  needsReviewCount: 0,
  message: 'Waiting for the collector worker.',
  createdAt: '2026-09-11T08:00:00.000Z',
  updatedAt: '2026-09-11T08:00:00.000Z',
};

test('the D1 adapter maps stored ImportJobs into the application contract', async () => {
  const database = {
    prepare(sql) {
      assert.match(sql, /FROM import_jobs ORDER BY created_at DESC/u);
      return {
        async all() {
          return {
            results: [
              {
                id: job.id,
                source_ref: job.sourceRef,
                creator_name: job.creatorName,
                platform: job.platform,
                status: job.status,
                discovered_count: job.discoveredCount,
                needs_review_count: job.needsReviewCount,
                message: job.message,
                created_at: job.createdAt,
                updated_at: job.updatedAt,
              },
            ],
          };
        },
      };
    },
  };
  const application = createAtlasApplication(
    createImportJobOperationGroup(new D1ImportJobState(database), dependencies),
  );

  assert.deepEqual(
    await application.execute({ key: 'import.list', input: {} }),
    { ok: true, value: [job] },
  );
});

test('the D1 adapter inserts the queued ImportJob produced by the application', async () => {
  const bindings = [];
  const database = {
    prepare(sql) {
      assert.match(sql, /INSERT INTO import_jobs/u);
      return {
        bind(...values) {
          bindings.push(values);
          return {
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
  const application = createAtlasApplication(
    createImportJobOperationGroup(new D1ImportJobState(database), {
      clock: { now: () => '2026-09-12T10:00:00.000Z' },
      idSource: { nextId: () => 'job-created' },
    }),
  );

  const result = await application.execute({
    key: 'import.queue',
    input: {
      sourceRef: 'https://www.youtube.com/watch?v=example',
      creatorName: 'Creator',
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(bindings, [
    [
      'job-created',
      'https://www.youtube.com/watch?v=example',
      'Creator',
      'YouTube',
      'queued',
      0,
      0,
      'Waiting for the collector worker.',
      '2026-09-12T10:00:00.000Z',
      '2026-09-12T10:00:00.000Z',
    ],
  ]);
});

test('the D1 adapter reports whether an ImportJob row was deleted', async () => {
  const deletedIds = [];
  const database = {
    prepare(sql) {
      assert.match(sql, /DELETE FROM import_jobs WHERE id = \?/u);
      return {
        bind(id) {
          deletedIds.push(id);
          return {
            async run() {
              return { meta: { changes: id === 'job-present' ? 1 : 0 } };
            },
          };
        },
      };
    },
  };
  const state = new D1ImportJobState(database);

  assert.equal(await state.delete('job-present'), true);
  assert.equal(await state.delete('job-missing'), false);
  assert.deepEqual(deletedIds, ['job-present', 'job-missing']);
});
