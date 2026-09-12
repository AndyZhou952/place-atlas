import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const applicationRoot = fileURLToPath(new URL('.', import.meta.url));

test('Product Core does not depend on feature-layer contracts', () => {
  for (const filename of productionTypeScriptFiles(applicationRoot)) {
    assert.doesNotMatch(
      readFileSync(filename, 'utf8'),
      /(?:from|import)\s+['"][^'"]*features\//u,
      filename,
    );
  }
});

function productionTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return productionTypeScriptFiles(filename);
    if (
      !entry.name.endsWith('.ts') ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.typecheck.ts')
    ) {
      return [];
    }
    return [filename];
  });
}
