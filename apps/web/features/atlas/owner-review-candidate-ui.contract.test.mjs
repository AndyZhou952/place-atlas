import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

void test('Owner Inbox presents candidates as a separate accessible review list', async () => {
  const [screen, viewModel] = await Promise.all([
    readFile(new URL('./atlas-screen.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./use-atlas-view-model.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(screen, /Review candidates/u);
  assert.match(screen, /aria-busy=/u);
  assert.match(screen, /<output[\s\S]*aria-live="polite"/u);
  assert.match(screen, /role="alert"/u);
  assert.match(screen, /Sign in as Owner to see review candidates/u);
  assert.match(screen, /No places need review/u);
  assert.match(screen, /Address unknown/u);
  assert.match(screen, /vm\.reviewCandidates\.map/u);
  assert.match(viewModel, /catalog\.review_candidates\.list/u);
  assert.match(viewModel, /reviewCandidateLoadState/u);
  assert.match(viewModel, /OwnerAuthenticationRequiredError/u);
  assert.match(
    screen,
    /reviewCandidateLoadState === 'ready'[\s\S]*!vm\.reviewCandidates\.length/u,
  );
  assert.doesNotMatch(screen, /items=\{vm\.reviewCandidates\}/u);
  assert.doesNotMatch(viewModel, /setItems\(reviewCandidates/u);
});
