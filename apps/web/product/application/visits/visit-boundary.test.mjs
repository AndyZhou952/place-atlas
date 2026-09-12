import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const visitRoot = fileURLToPath(new URL('.', import.meta.url));

test('Visit handlers receive item projection through a narrow seam', () => {
  for (const filename of productionTypeScriptFiles(visitRoot)) {
    const source = readFileSync(filename, 'utf8');
    assert.doesNotMatch(source, /\bprojectCatalog\b/u, filename);
    assert.doesNotMatch(source, /\bCatalogStateSnapshot\b/u, filename);
    assert.doesNotMatch(source, /\btoCatalogSnapshot\b/u, filename);
  }
});

function productionTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return productionTypeScriptFiles(filename);
    return entry.name.endsWith('.ts') ? [filename] : [];
  });
}
