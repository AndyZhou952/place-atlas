import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createImportJobOperationGroup } from '../../../product/application/import-jobs/import-job-operations.ts';
import { InMemoryImportJobState } from '../../../product/application/import-jobs/in-memory-import-job-state.ts';
import { listImportJobsResponse } from './list-import-jobs-response.ts';

const dependencies = {
  clock: { now: () => '2026-09-12T00:00:00.000Z' },
  idSource: { nextId: () => 'unused-job-id' },
};

const job = {
  id: 'job-1',
  sourceRef: 'https://example.com/source',
  creatorName: 'Example source',
  platform: 'Web',
  status: 'queued',
  discoveredCount: 0,
  needsReviewCount: 0,
  message: 'Waiting for the collector worker.',
  createdAt: '2026-09-11T08:00:00.000Z',
  updatedAt: '2026-09-11T08:00:00.000Z',
};

test('the Inbox GET adapter preserves its successful JSON response', async () => {
  const application = createAtlasApplication(
    createImportJobOperationGroup(
      new InMemoryImportJobState([job]),
      dependencies,
    ),
  );

  const response = await listImportJobsResponse(application);

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-type') ?? '',
    /application\/json/u,
  );
  assert.deepEqual(await response.json(), [job]);
});
