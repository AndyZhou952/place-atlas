import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createImportJobOperationGroup } from './import-job-operations.ts';
import { InMemoryImportJobState } from './in-memory-import-job-state.ts';

const fixedDependencies = {
  clock: {
    now() {
      return '2026-09-12T09:30:00.000Z';
    },
  },
  idSource: {
    nextId() {
      return 'job-fixed';
    },
  },
};

test('queue creates a waiting ImportJob with inferred platform and deterministic identity', async () => {
  const application = createAtlasApplication(
    createImportJobOperationGroup(
      new InMemoryImportJobState(),
      fixedDependencies,
    ),
  );

  const result = await application.execute({
    key: 'import.queue',
    input: {
      sourceRef: 'https://www.xiaohongshu.com/explore/source',
      creatorName: 'Example creator',
    },
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      id: 'job-fixed',
      sourceRef: 'https://www.xiaohongshu.com/explore/source',
      creatorName: 'Example creator',
      platform: 'Xiaohongshu',
      status: 'queued',
      discoveredCount: 0,
      needsReviewCount: 0,
      createdAt: '2026-09-12T09:30:00.000Z',
      updatedAt: '2026-09-12T09:30:00.000Z',
      message: 'Waiting for the collector worker.',
    },
  });
});

test('delete removes an existing ImportJob and reports its identity', async () => {
  const job = {
    id: 'job-delete',
    sourceRef: 'https://example.com/source',
    creatorName: 'Example creator',
    platform: 'Web',
    status: 'queued',
    discoveredCount: 0,
    needsReviewCount: 0,
    createdAt: '2026-09-12T09:30:00.000Z',
    updatedAt: '2026-09-12T09:30:00.000Z',
    message: 'Waiting for the collector worker.',
  };
  const state = new InMemoryImportJobState([job]);
  const application = createAtlasApplication(
    createImportJobOperationGroup(state, fixedDependencies),
  );

  assert.deepEqual(
    await application.execute({
      key: 'import.delete',
      input: { id: job.id },
    }),
    { ok: true, value: { id: job.id, deleted: true } },
  );
  assert.deepEqual(
    await application.execute({ key: 'import.list', input: {} }),
    { ok: true, value: [] },
  );
});

test('queue preserves explicit platforms and infers every existing source family', async () => {
  const cases = [
    ['rednote:creator', 'Xiaohongshu'],
    ['https://www.bilibili.com/video/example', 'Bilibili'],
    ['https://www.youtube.com/watch?v=example', 'YouTube'],
    ['https://x.com/example/status/1', 'X'],
    ['https://example.com/article', 'Web'],
  ];

  for (const [sourceRef, platform] of cases) {
    const application = createAtlasApplication(
      createImportJobOperationGroup(
        new InMemoryImportJobState(),
        fixedDependencies,
      ),
    );
    const result = await application.execute({
      key: 'import.queue',
      input: { sourceRef, creatorName: 'Creator' },
    });
    assert.equal(result.ok && result.value.platform, platform);
  }

  const application = createAtlasApplication(
    createImportJobOperationGroup(
      new InMemoryImportJobState(),
      fixedDependencies,
    ),
  );
  const explicit = await application.execute({
    key: 'import.queue',
    input: {
      sourceRef: 'https://example.com/source',
      creatorName: 'Creator',
      platform: 'Custom',
    },
  });
  assert.equal(explicit.ok && explicit.value.platform, 'Custom');
});

test('delete reports not_found when the ImportJob does not exist', async () => {
  const application = createAtlasApplication(
    createImportJobOperationGroup(
      new InMemoryImportJobState(),
      fixedDependencies,
    ),
  );

  assert.deepEqual(
    await application.execute({
      key: 'import.delete',
      input: { id: 'missing-job' },
    }),
    {
      ok: false,
      error: { kind: 'not_found', message: 'Import job not found.' },
    },
  );
});

test('ImportJob write storage failures become sanitized dependency errors', async () => {
  const failingState = {
    async list() {
      return [];
    },
    async insert() {
      throw new Error('secret insert detail');
    },
    async delete() {
      throw new Error('secret delete detail');
    },
  };
  const application = createAtlasApplication(
    createImportJobOperationGroup(failingState, fixedDependencies),
  );

  assert.deepEqual(
    await application.execute({
      key: 'import.queue',
      input: { sourceRef: 'https://example.com', creatorName: 'Creator' },
    }),
    {
      ok: false,
      error: {
        kind: 'dependency_failure',
        message: 'The import job could not be queued.',
      },
    },
  );
  assert.deepEqual(
    await application.execute({
      key: 'import.delete',
      input: { id: 'job-1' },
    }),
    {
      ok: false,
      error: {
        kind: 'dependency_failure',
        message: 'The import job could not be deleted.',
      },
    },
  );
});
