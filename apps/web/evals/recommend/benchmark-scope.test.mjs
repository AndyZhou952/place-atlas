import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

test('Recommend and retained Nearby benchmark data contains no train-time cases', () => {
  for (const directory of ['./', '../nearby/']) {
    const folder = new URL(directory, import.meta.url);
    for (const filename of readdirSync(folder).filter((name) =>
      name.endsWith('.json'),
    )) {
      const dataset = JSON.parse(
        readFileSync(new URL(filename, folder), 'utf8'),
      );
      assert.doesNotMatch(
        JSON.stringify(dataset.cases ?? []),
        /\btrain\b|transit|電車|电车|直達|直达|乗換/iu,
        filename,
      );
    }
  }
});
