import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { verifyMigrationPackaging } from './migration-packaging.ts';

const webRoot = fileURLToPath(new URL('../', import.meta.url));

test('a deploy candidate using retired Site version 16 is rejected', () => {
  assert.throws(
    () =>
      verifyMigrationPackaging({
        root: webRoot,
        stage: 'snapshot-only',
        candidateSiteVersion: 16,
      }),
    /Site version 16 is permanently retired/u,
  );
});
