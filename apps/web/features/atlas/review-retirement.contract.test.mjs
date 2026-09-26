import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';

test('only Map and Journal remain and the browser never requests a review queue', async () => {
  const screen = await readFile(new URL('./atlas-screen.tsx', import.meta.url), 'utf8');
  const model = await readFile(new URL('./use-atlas-view-model.ts', import.meta.url), 'utf8');
  const operations = await readFile(new URL('./atlas-browser-operation-catalog.ts', import.meta.url), 'utf8');
  assert.match(screen, /value: 'map', label: 'Map'/u);
  assert.match(screen, /value: 'journal', label: 'Journal'/u);
  assert.doesNotMatch(screen, /ReviewWorkspace|label="Review"|value: 'review'/u);
  assert.doesNotMatch(model + operations, /catalog\.review_candidates|reviewCandidate/u);
  await assert.rejects(access(new URL('../../app/api/owner/catalog/review-candidates/route.ts', import.meta.url)));
});
