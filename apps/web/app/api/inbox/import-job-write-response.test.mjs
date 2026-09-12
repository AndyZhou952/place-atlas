import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createImportJobOperationGroup } from '../../../product/application/import-jobs/import-job-operations.ts';
import { InMemoryImportJobState } from '../../../product/application/import-jobs/in-memory-import-job-state.ts';
import {
  deleteImportJobResponse,
  queueImportJobResponse,
} from './import-job-write-response.ts';

const dependencies = {
  clock: { now: () => '2026-09-12T11:00:00.000Z' },
  idSource: { nextId: () => 'job-http' },
};

test('the Inbox POST adapter preserves the successful 201 JSON response', async () => {
  const application = createAtlasApplication(
    createImportJobOperationGroup(new InMemoryImportJobState(), dependencies),
  );

  const response = await queueImportJobResponse(application, {
    sourceRef: '  https://www.bilibili.com/video/example  ',
    creatorName: '  Creator  ',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    id: 'job-http',
    sourceRef: 'https://www.bilibili.com/video/example',
    creatorName: 'Creator',
    platform: 'Bilibili',
    status: 'queued',
    discoveredCount: 0,
    needsReviewCount: 0,
    createdAt: '2026-09-12T11:00:00.000Z',
    updatedAt: '2026-09-12T11:00:00.000Z',
    message: 'Waiting for the collector worker.',
  });
});

test('the Inbox DELETE adapter preserves success and missing-job responses', async () => {
  const job = {
    id: 'job-http-delete',
    sourceRef: 'https://example.com',
    creatorName: 'Creator',
    platform: 'Web',
    status: 'queued',
    discoveredCount: 0,
    needsReviewCount: 0,
    createdAt: '2026-09-12T11:00:00.000Z',
    updatedAt: '2026-09-12T11:00:00.000Z',
    message: 'Waiting for the collector worker.',
  };
  const application = createAtlasApplication(
    createImportJobOperationGroup(
      new InMemoryImportJobState([job]),
      dependencies,
    ),
  );

  const deleted = await deleteImportJobResponse(application, job.id);
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { id: job.id, deleted: true });

  const missing = await deleteImportJobResponse(application, job.id);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Import job not found');
});

test('the Inbox write adapters map invalid input and dependency failures without leaking details', async () => {
  const state = {
    async list() {
      return [];
    },
    async insert() {
      throw new Error('secret database insert');
    },
    async delete() {
      throw new Error('secret database delete');
    },
  };
  const application = createAtlasApplication(
    createImportJobOperationGroup(state, dependencies),
  );

  const invalidQueue = await queueImportJobResponse(application, {
    sourceRef: ' ',
    creatorName: 'Creator',
  });
  assert.equal(invalidQueue.status, 400);
  assert.equal(
    await invalidQueue.text(),
    'Creator name and source reference are required',
  );

  const failedQueue = await queueImportJobResponse(application, {
    sourceRef: 'https://example.com',
    creatorName: 'Creator',
  });
  assert.equal(failedQueue.status, 500);
  assert.equal(await failedQueue.text(), 'The import job could not be queued.');

  const invalidDelete = await deleteImportJobResponse(application, '');
  assert.equal(invalidDelete.status, 400);
  assert.equal(await invalidDelete.text(), 'Import job ID is required');

  const failedDelete = await deleteImportJobResponse(application, 'job-1');
  assert.equal(failedDelete.status, 500);
  assert.equal(
    await failedDelete.text(),
    'The import job could not be deleted.',
  );
});
