import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAtlasApplication,
  defineOperationGroup,
} from '../atlas-application.ts';
import { success } from '../result.ts';
import { createImportJobOperationGroup } from './import-job-operations.ts';
import { InMemoryImportJobState } from './in-memory-import-job-state.ts';

const dependencies = {
  clock: { now: () => '2026-09-12T00:00:00.000Z' },
  idSource: { nextId: () => 'unused-job-id' },
};

const olderJob = {
  id: 'job-older',
  sourceRef: 'https://example.com/older',
  creatorName: 'Older source',
  platform: 'Web',
  status: 'queued',
  discoveredCount: 0,
  needsReviewCount: 0,
  message: 'Waiting for the collector worker.',
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
};

const newerJob = {
  ...olderJob,
  id: 'job-newer',
  sourceRef: 'https://example.com/newer',
  creatorName: 'Newer source',
  createdAt: '2026-09-11T08:00:00.000Z',
  updatedAt: '2026-09-11T08:00:00.000Z',
};

test('ImportJobs are listed through AtlasApplication in newest-first order', async () => {
  const state = new InMemoryImportJobState([olderJob, newerJob]);
  const application = createAtlasApplication(
    createImportJobOperationGroup(state, dependencies),
  );

  const result = await application.execute({
    key: 'import.list',
    input: {},
  });

  assert.deepEqual(result, {
    ok: true,
    value: [newerJob, olderJob],
  });
});

test('ImportJob list rejects runtime input outside its typed contract', async () => {
  const application = createAtlasApplication(
    createImportJobOperationGroup(new InMemoryImportJobState(), dependencies),
  );

  assert.deepEqual(
    await application.execute({
      key: 'import.list',
      input: { unexpected: true },
    }),
    {
      ok: false,
      error: {
        kind: 'invalid_input',
        message: 'This operation does not accept input.',
      },
    },
  );
});

test('ImportJob storage failures become a sanitized dependency error', async () => {
  const application = createAtlasApplication(
    createImportJobOperationGroup(
      {
        async list() {
          throw new Error('Storage vendor detail');
        },
      },
      dependencies,
    ),
  );

  assert.deepEqual(
    await application.execute({ key: 'import.list', input: {} }),
    {
      ok: false,
      error: {
        kind: 'dependency_failure',
        message: 'Import jobs are temporarily unavailable.',
      },
    },
  );
});

test('validator exceptions become a fixed sanitized unexpected failure', async () => {
  const application = createAtlasApplication(
    defineOperationGroup({
      'fixture.validator-crash': {
        descriptor: {
          key: 'fixture.validator-crash',
          resultKind: 'json',
          effect: 'read',
          validate() {
            throw new Error('secret validator detail');
          },
        },
        async handle() {
          return success('unreachable');
        },
      },
    }),
  );

  assert.deepEqual(
    await application.execute({
      key: 'fixture.validator-crash',
      input: {},
    }),
    {
      ok: false,
      error: {
        kind: 'unexpected_failure',
        message: 'The application operation could not be completed.',
      },
    },
  );
});
