import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateCatalogHoursContract } from './catalog-hours-score.mjs';

const inventory = JSON.parse(
  readFileSync(
    new URL('./catalog-hours-inventory.v1.json', import.meta.url),
    'utf8',
  ),
);

test('independent inventory contains all 56 exact catalog identities', () => {
  assert.equal(inventory.cases.length, 56);
  assert.equal(new Set(inventory.cases.map((item) => item.itemId)).size, 56);
  assert.ok(inventory.cases.every((item) => item.name && item.address));
  assert.equal(
    inventory.cases.filter((item) => item.listingUrl === null).length,
    1,
  );
});

test('canonical hours manifest covers every inventory identity and every fact has evidence', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('./catalog-hours.v1.json', import.meta.url), 'utf8'),
  );
  const result = validateCatalogHoursContract(manifest, inventory);
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.equal(result.total, 56);
});
