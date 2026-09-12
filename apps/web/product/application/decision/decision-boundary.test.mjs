import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Decision operations do not import Catalog runtime implementations', () => {
  const filename = fileURLToPath(
    new URL('./decision-operations.ts', import.meta.url),
  );
  const source = readFileSync(filename, 'utf8');
  const withoutTypeImports = source.replace(
    /import\s+type\s+(?:\{[\s\S]*?\}|[^;]+)\s+from\s+['"][^'"]+['"];?\s*/gu,
    '',
  );

  assert.doesNotMatch(
    withoutTypeImports,
    /from\s+['"][^'"]*catalog\//u,
    'Decision must receive the internal Catalog read seam instead of importing a Catalog runtime implementation.',
  );
});
