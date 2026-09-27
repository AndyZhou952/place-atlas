import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  compactRestaurantTags,
  composeRestaurantSummary,
} from '../../product/application/catalog-intake/restaurant-profile-presentation.ts';

const gold = JSON.parse(
  await readFile(
    new URL('./add-presentation-gold.v1.json', import.meta.url),
    'utf8',
  ),
);

test('Add publication presentation meets every controlled content-quality case', () => {
  assert.equal(gold.schemaVersion, 1);
  assert.equal(gold.cases.length, 4);
  for (const entry of gold.cases) {
    assert.equal(
      composeRestaurantSummary(entry.input) ?? null,
      entry.expected.summary,
      `${entry.caseId}: summary`,
    );
    assert.deepEqual(
      compactRestaurantTags(entry.input.categories, entry.input.dishes),
      entry.expected.tags,
      `${entry.caseId}: tags`,
    );
  }
});
