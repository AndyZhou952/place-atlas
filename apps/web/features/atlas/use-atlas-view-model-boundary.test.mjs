import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the React ViewModel sends every persistent operation through the Browser AtlasApplication', async () => {
  const source = await readFile(
    new URL('./use-atlas-view-model.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /import \{[^}]*\bbrowserAtlasApplication\b[^}]*\} from '.\/atlas-api-client'/u,
  );
  assert.match(source, /reduceAtlasViewModelState/);
  assert.doesNotMatch(source, /fetch\(|['"]\/api\//);
  assert.doesNotMatch(
    source,
    /fetchAtlasItems|fetchImportJobs|fetchVisits|fetchVisitMedia|updateItemAssessment|uploadVisitMedia|deleteAtlasItem/,
  );
  assert.doesNotMatch(source, /import\.(?:list|queue)|queueImport|importJobs/u);
  assert.doesNotMatch(source, /hasAnotherVisit|distanceInKm|visitCount/);
});

test('durable catalog loading starts empty and the screen hides place views until records arrive', async () => {
  const viewModel = await readFile(
    new URL('./use-atlas-view-model.ts', import.meta.url),
    'utf8',
  );
  const screen = await readFile(
    new URL('./atlas-screen.tsx', import.meta.url),
    'utf8',
  );

  assert.match(viewModel, /createAtlasViewModelState\(\)/u);
  assert.doesNotMatch(viewModel, /verifiedAtlasItems/u);
  assert.match(viewModel, /loaded: false,[\s\S]*loading: true/u);
  assert.match(
    screen,
    /<output className="notice-bar" aria-live="polite">[\s\S]*Loading saved Atlas records/u,
  );
  assert.match(screen, /role="alert"[\s\S]*vm\.catalogError[\s\S]*Retry/u);
  assert.match(screen, /vm\.catalogLoaded \?[\s\S]*MapWorkspace/u);
});
