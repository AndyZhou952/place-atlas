import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenSource = await readFile(
  new URL('./atlas-screen.tsx', import.meta.url),
  'utf8',
);
const cssSource = await readFile(
  new URL('../../app/globals.css', import.meta.url),
  'utf8',
);

void test('place detail keeps an anonymous-readable overall comment with an explicit edit action', () => {
  assert.match(screenSource, /className="overall-comment-copy"/u);
  assert.match(screenSource, /item\.overallComment/u);
  assert.match(screenSource, /Edit overall comment/u);
  assert.match(screenSource, /No overall comment yet\./u);
});

void test('overall comment editor exposes saving, error, and success states around assessment.update', () => {
  assert.match(
    screenSource,
    /vm\.saveAssessment\(item\.id, \{ summary: normalized \}\)/u,
  );
  assert.match(screenSource, /aria-busy=\{status === 'saving'\}/u);
  assert.match(screenSource, /role="alert"/u);
  assert.match(screenSource, /<output/u);
  assert.match(screenSource, /Comment saved\./u);
  assert.match(screenSource, /Comment could not be saved\./u);
});

void test('overall comment textarea and actions retain accessible mobile touch targets', () => {
  assert.match(
    cssSource,
    /\.overall-comment-editor textarea\s*\{[^}]*min-height:\s*7rem/u,
  );
  assert.match(
    cssSource,
    /\.overall-comment-actions \[data-slot='button'\]\s*\{[^}]*min-height:\s*2\.75rem/u,
  );
});
