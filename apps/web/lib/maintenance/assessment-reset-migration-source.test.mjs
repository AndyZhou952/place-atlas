import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { readAssessmentResetMigration } from './assessment-reset.ts';

const pendingResetUrl = new URL(
  '../../drizzle/pending/0004_reset_test_place_assessments.sql',
  import.meta.url,
);
const retiredActiveResetUrl = new URL(
  '../../drizzle/0003_reset_test_place_assessments.sql',
  import.meta.url,
);

test('offline reset rehearsal reads only the pending immutable reset artifact', () => {
  assert.equal(readAssessmentResetMigration(), readFileSync(pendingResetUrl, 'utf8'));
  assert.equal(existsSync(retiredActiveResetUrl), false);
});
