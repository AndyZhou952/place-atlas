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
    0,
  );
});

test('canonical hours manifest covers every inventory identity and every fact has evidence', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('./catalog-hours.v1.json', import.meta.url), 'utf8'),
  );
  const result = validateCatalogHoursContract(manifest, inventory);
  assert.equal(result.pass, true, result.errors.join('\n'));
  assert.equal(result.total, 56);
  assert.equal(
    manifest.benchmarkId,
    'catalog-hours-tabelog-only-2026-10-04-v2',
  );
  assert.equal(manifest.scheduleSourcePolicy, 'tabelog_only');
});

test('active Tabelog-only policy rejects a different or supplemental source', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('./catalog-hours.v1.json', import.meta.url), 'utf8'),
  );
  const sample = structuredClone(manifest);
  const active = sample.cases.find((item) => item.hoursStatus === 'known');
  active.openingHours.sourceUrl = 'https://example.com/other-branch-hours';
  active.evidence.push({
    sourceUrl: 'https://example.com/other-branch-hours',
    quote: active.openingHours.value,
    note: 'unsupported alternate source',
  });
  const result = validateCatalogHoursContract(sample, inventory);
  assert.equal(result.pass, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes('source must be its exact Tabelog listingUrl'),
    ),
  );
  assert.ok(
    result.errors.some((error) =>
      error.includes('Tabelog-only evidence must use its exact listingUrl'),
    ),
  );
});

test('an alias address quote must occur in exact-listing page evidence', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('./catalog-hours.v1.json', import.meta.url), 'utf8'),
  );
  const altered = structuredClone(manifest);
  const sample = altered.cases.find(
    (item) => item.name === 'Recoco Record Cafe',
  );
  sample.verifiedNameAliases[0].addressQuote =
    '東京都渋谷区渋谷9-9-9 別の建物 1F';
  const result = validateCatalogHoursContract(altered, inventory);
  assert.equal(result.pass, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes('verified name alias lacks exact-source evidence'),
    ),
  );
});
