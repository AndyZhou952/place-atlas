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
  assert.match(panel, /translate="no"/u);
  assert.match(panel, /candidate\.attribution\.label/u);
  assert.match(panel, /aria-busy/u);
  assert.match(panel, /aria-live="polite"/u);
  assert.match(panel, /aria-invalid/u);
  assert.match(panel, /aria-describedby/u);
  assert.match(panel, /disabled/u);
  assert.match(panel, /tabIndex=\{-1\}/u);
  assert.match(panel, /role="alert"/u);
  assert.ok(
    screen.indexOf('<CatalogIntakePanel') >
      screen.indexOf('className="collection-heading"'),
  );
  assert.ok(
    screen.indexOf('<CatalogIntakePanel') <
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

test('Owner Add confirm exposes loading and retries the same confirm operation', async () => {
  const [hook, panel] = await Promise.all([
    readFile(new URL('./use-catalog-intake.ts', import.meta.url), 'utf8'),
    readFile(new URL('./catalog-intake-panel.tsx', import.meta.url), 'utf8'),
  ]);

  assert.match(hook, /dispatch\(\{ type: 'confirm_started' \}\)/u);
  assert.match(
    hook,
    /state\.lastOperation === 'confirm'\) return confirm\(\)/u,
  );
  assert.match(panel, /Confirming and saving…/u);
  assert.match(panel, /state\.previousStage === 'preview'/u);
  assert.match(panel, /disabled=\{busy\}/u);
});

test('Google candidate attribution keeps the official text treatment legible and unbroken', async () => {
  const [panel, styles] = await Promise.all([
    readFile(new URL('./catalog-intake-panel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../app/globals.css', import.meta.url), 'utf8'),
  ]);

  assert.match(panel, /className="catalog-intake-google-attribution"/u);
  assert.match(panel, /translate="no"/u);
  assert.match(
    styles,
    /\.catalog-intake-google-attribution[\s\S]*font-family: Roboto, Arial, sans-serif;[\s\S]*font-size: 1rem;[\s\S]*font-weight: 400;[\s\S]*white-space: nowrap;/u,
  );
});

test('Owner can confirm the reviewed preview from the Add panel', async () => {
  const panel = await readFile(
    new URL('./catalog-intake-panel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(panel, /onConfirm=\{intake\.confirm\}/u);
  assert.match(panel, /onClick=\{\(\) => void onConfirm\(\)\}/u);
  assert.doesNotMatch(
    panel,
    /Final catalog publishing is not connected yet\./u,
  );
});

test('Web preview and confirm-refresh conflict use the shared closed evidence presentation', async () => {
  const [panel, styles] = await Promise.all([
    readFile(new URL('./catalog-intake-panel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../app/globals.css', import.meta.url), 'utf8'),
  ]);

  assert.match(panel, /presentCatalogIntakePreview/u);
  assert.match(panel, /presentation\.fields\.map/u);
  assert.match(panel, /presentation\.duplicates/u);
  assert.match(panel, /presentation\.unknownFields/u);
  assert.match(panel, /presentation\.warnings/u);
  assert.match(panel, /state\.stage === 'conflict' && state\.preview/u);
  assert.match(panel, /Review changed preview and confirm again/u);
  assert.match(styles, /\.catalog-intake-conflict \{/u);
  assert.match(styles, /\.catalog-intake-conflict \.catalog-intake-preview/u);
});

test('a committed Add refreshes both verified and Owner-review catalog views', async () => {
  const [panel, screen, hook, viewModel] = await Promise.all([
    readFile(new URL('./catalog-intake-panel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./atlas-screen.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./use-catalog-intake.ts', import.meta.url), 'utf8'),
    readFile(new URL('./use-atlas-view-model.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(panel, /useCatalogIntake\(onCommitted\)/u);
  assert.match(hook, /onCommitted\?\.\(output\)/u);
  assert.match(
    screen,
    /<CatalogIntakePanel onCommitted=\{vm\.reloadCatalogViews\} \/>/u,
  );
  assert.match(viewModel, /key: 'catalog\.list'/u);
  assert.match(viewModel, /reloadCatalogViews/u);
  assert.match(viewModel, /setReviewCandidateLoadRevision/u);
});

test('success copy distinguishes verified map visibility from Owner review', async () => {
  const panel = await readFile(
    new URL('./catalog-intake-panel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(panel, /available on the verified map and Nearby/u);
  assert.match(panel, /saved to Owner review/u);
  assert.match(panel, /not visible on the public map or Nearby yet/u);
});
