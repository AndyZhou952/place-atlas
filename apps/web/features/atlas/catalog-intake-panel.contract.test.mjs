import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Owner Add panel is a separate accessible intake surface before collection search', async () => {
  const [panel, screen, hook] = await Promise.all([
    readFile(new URL('./catalog-intake-panel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./atlas-screen.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./use-catalog-intake.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(panel, /<fieldset/u);
  assert.match(panel, /type="radio"/u);
  assert.match(panel, /aria-busy/u);
  assert.match(panel, /aria-live="polite"/u);
  assert.match(panel, /aria-invalid/u);
  assert.match(panel, /aria-describedby/u);
  assert.match(panel, /disabled/u);
  assert.match(panel, /Final catalog publishing is not connected yet\./u);
  assert.match(panel, /tabIndex=\{-1\}/u);
  assert.match(panel, /role="alert"/u);
  assert.ok(
    screen.indexOf('<CatalogIntakePanel />') >
      screen.indexOf('className="collection-heading"'),
  );
  assert.ok(
    screen.indexOf('<CatalogIntakePanel />') <
      screen.indexOf('className="search-field"'),
  );
  assert.match(screen, /inert=\{!listOpen\}/u);
  for (const forbidden of [
    '/api/items',
    'ownerId',
    'Nominatim',
    'nominatim',
    'GooglePlace',
    'D1',
    'WebMCP',
  ]) {
    assert.equal(panel.includes(forbidden), false, forbidden);
    assert.equal(hook.includes(forbidden), false, forbidden);
  }
});
