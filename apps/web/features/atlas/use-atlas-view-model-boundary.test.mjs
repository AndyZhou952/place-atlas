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
    /import \{ browserAtlasApplication \} from '.\/atlas-api-client'/,
  );
  assert.match(source, /reduceAtlasViewModelState/);
  assert.doesNotMatch(source, /fetch\(|['"]\/api\//);
  assert.doesNotMatch(
    source,
    /fetchAtlasItems|fetchImportJobs|fetchVisits|fetchVisitMedia|updateItemAssessment|uploadVisitMedia|deleteAtlasItem/,
  );
  assert.doesNotMatch(source, /hasAnotherVisit|distanceInKm|visitCount/);
});
