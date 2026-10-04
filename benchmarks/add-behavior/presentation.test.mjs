import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  compactRestaurantTags,
  composeRestaurantSummary,
} from '../../apps/web/product/application/catalog-intake/restaurant-profile-presentation.ts';

const dataset = JSON.parse(
  await readFile(new URL('./presentation.v1.json', import.meta.url), 'utf8'),
);

assert.equal(dataset.schemaVersion, 1);
assert.equal(dataset.cases.length, 17);
for (const entry of dataset.cases) {
  test(`Add presentation: ${entry.caseId}`, () => {
    const summary = composeRestaurantSummary(entry.input) ?? null;
    const tags = compactRestaurantTags(
      entry.input.categories,
      entry.input.dishes,
      entry.input.area,
    );
    assert.equal(summary, entry.expected.summary, `${entry.caseId}: summary`);
    assert.deepEqual(tags, entry.expected.tags, `${entry.caseId}: tags`);
    assert.ok(tags.length <= 4, `${entry.caseId}: tag budget`);
    assert.ok(
      tags.filter((tag) => entry.input.dishes.includes(tag)).length <= 2,
      `${entry.caseId}: top dish budget`,
    );
  });
}
