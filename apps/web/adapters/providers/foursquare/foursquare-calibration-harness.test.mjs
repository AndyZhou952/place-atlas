import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runFoursquareOfflineCalibration } from './foursquare-calibration-harness.ts';

const calibrationDirectory = new URL(
  './fixtures/calibration/',
  import.meta.url,
);

test('offline Foursquare calibration runs fixed Japanese branch, same-name, empty, and error fixtures without a provider request', async () => {
  const [branch, sameName, empty, error] = await Promise.all(
    [
      'japan-branch-synthetic.response.json',
      'japan-same-name-synthetic.response.json',
      'empty-synthetic.response.json',
      'error-synthetic.response.json',
    ].map(readJson),
  );

  const report = runFoursquareOfflineCalibration([
    {
      id: 'japan-branch',
      payload: branch,
      expected: { outcome: 'mapped', stablePlaceIds: ['fsq-tokyo-branch-1'] },
    },
    {
      id: 'japan-same-name',
      payload: sameName,
      expected: {
        outcome: 'mapped',
        stablePlaceIds: ['fsq-same-name-ginza', 'fsq-same-name-tsukiji'],
      },
    },
    { id: 'empty', payload: empty, expected: { outcome: 'empty' } },
    { id: 'error', payload: error, expected: { outcome: 'abstain' } },
  ]);

  assert.deepEqual(report, {
    total: 4,
    passed: 4,
    failed: [],
    outcomes: [
      { id: 'japan-branch', outcome: 'mapped' },
      { id: 'japan-same-name', outcome: 'mapped' },
      { id: 'empty', outcome: 'empty' },
      { id: 'error', outcome: 'abstain' },
    ],
  });
});

async function readJson(filename) {
  return JSON.parse(
    await readFile(new URL(filename, calibrationDirectory), 'utf8'),
  );
}
