import assert from 'node:assert/strict';
import test from 'node:test';
import { savedDuplicateIds } from './live-catalog-state.mjs';

test('live duplicate expectation follows saved source identity across names', () => {
  const sample = { expectedTabelogUrl: 'https://tabelog.com/listing/1/' };
  const saved = {
    id: 'saved',
    kind: 'food',
    verificationStatus: 'verified',
    title: 'An alternate language name',
    tabelog: { url: sample.expectedTabelogUrl },
  };
  assert.deepEqual(savedDuplicateIds(sample, []), []);
  assert.deepEqual(savedDuplicateIds(sample, [saved]), ['saved']);
  assert.deepEqual(
    savedDuplicateIds(sample, [
      {
        ...saved,
        id: 'another-branch',
        tabelog: { url: 'https://tabelog.com/listing/2/' },
      },
      { ...saved, id: 'unverified', verificationStatus: 'candidate' },
    ]),
    [],
  );
});
