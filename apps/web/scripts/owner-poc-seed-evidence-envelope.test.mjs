import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerPocSeedEvidenceEnvelope } from './owner-poc-seed-evidence-envelope.ts';

void test('seed evidence capture binds Wrangler rows to the selected target D1 and capture time', () => {
  const rows = [{ id: 'seed-1', payload_json: '{"title":"seed"}' }];
  const capturedAt = new Date('2026-09-21T12:04:00.000Z');

  assert.deepEqual(
    createOwnerPocSeedEvidenceEnvelope({
      sourceConfig: {
        d1_databases: [
          {
            binding: 'DB',
            database_id: '11111111-2222-4333-8444-555555555555',
          },
        ],
      },
      rawEvidence: [{ results: rows, success: true }],
      capturedAt,
    }),
    {
      databaseId: '11111111-2222-4333-8444-555555555555',
      capturedAt: '2026-09-21T12:04:00.000Z',
      results: rows,
    },
  );

  for (const input of [
    {
      sourceConfig: { d1_databases: [] },
      rawEvidence: [{ results: rows }],
      capturedAt,
    },
    {
      sourceConfig: {
        d1_databases: [
          {
            binding: 'DB',
            database_id: '11111111-2222-4333-8444-555555555555',
          },
        ],
      },
      rawEvidence: rows,
      capturedAt,
    },
  ]) {
    assert.throws(() => createOwnerPocSeedEvidenceEnvelope(input));
  }
});
