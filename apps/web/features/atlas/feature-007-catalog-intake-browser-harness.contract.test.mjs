import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Feature 007 browser harness drives the running production React and CSS surface', async () => {
  const harness = await readFile(
    new URL(
      '../../scripts/feature-007-catalog-intake-browser-harness.py',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(harness, /page\.goto\(BASE_URL/u);
  assert.match(harness, /page\.locator\("\.catalog-intake"\)/u);
  assert.match(harness, /api\/catalog-intake/u);
  assert.match(harness, /390/u);
  assert.match(harness, /no_horizontal_overflow/u);
  assert.match(harness, /aria-describedby/u);
  assert.match(harness, /aria-expanded/u);
  assert.match(harness, /min_target_px/u);
  assert.match(harness, /Google Maps/u);
  assert.doesNotMatch(harness, /set_content|page\.content\s*=/u);
});
