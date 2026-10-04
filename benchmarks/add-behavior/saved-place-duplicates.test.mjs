import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { findSavedPlaceDuplicates } from '../../apps/web/product/application/catalog-intake/saved-place-duplicates.ts';

const dataset = JSON.parse(
  readFileSync(new URL('./saved-place-duplicates.v1.json', import.meta.url)),
);

function candidate(input) {
  return {
    candidateIdentity: {
      providerNamespace: input.provider,
      placeId: input.placeId,
    },
    ownerFields: {},
    titleProposal: { value: input.name },
    addressProposal: { value: input.address },
    locationEvidence: {
      status: 'known',
      latitude: input.latitude,
      longitude: input.longitude,
    },
    tabelog: input.tabelogUrl
      ? { status: 'known', url: input.tabelogUrl }
      : { status: 'unknown' },
  };
}

function saved(input) {
  return {
    id: 'saved-place',
    kind: 'food',
    title: input.title,
    address: input.address,
    latitude: input.latitude,
    longitude: input.longitude,
    sources: [],
    ...(input.tabelogUrl ? { tabelog: { url: input.tabelogUrl } } : {}),
    ...(input.provider
      ? {
          intakeEvidence: {
            candidateIdentity: {
              providerNamespace: input.provider,
              placeId: input.placeId,
            },
          },
        }
      : {}),
  };
}

test('saved-place duplicate benchmark preserves same-branch recognition and distinct-branch safety', () => {
  assert.equal(dataset.version, 1);
  assert.equal(dataset.cases.length, 10);
  for (const entry of dataset.cases) {
    const actual = findSavedPlaceDuplicates(candidate(entry.candidate), [
      saved(entry.saved),
    ]);
    assert.equal(actual[0]?.match ?? 'none', entry.expected, entry.id);
    assert.equal(actual.length, entry.expected === 'none' ? 0 : 1, entry.id);
  }
});
