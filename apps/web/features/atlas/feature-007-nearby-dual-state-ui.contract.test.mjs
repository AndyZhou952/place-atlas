import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./atlas-screen.tsx', import.meta.url),
  'utf8',
);

test('Nearby dependency failure says saved places were not checked and offers an explicit 44px retry', () => {
  assert.match(
    source,
    /result\.status === 'unresolved' &&\s*result\.reason === 'dependency_failure'/u,
  );
  assert.match(source, /Location service is temporarily unavailable\./u);
  assert.match(source, /No saved places were checked\./u);
  assert.match(
    source,
    /<Button[\s\S]*?type="button"[\s\S]*?className="min-h-11[^"]*"[\s\S]*?onClick=\{onRetry\}[\s\S]*?>[\s\S]*?Retry[\s\S]*?<\/Button>/u,
  );
});

test('Nearby not-found alone asks for a city or full address and never shows the dependency copy', () => {
  assert.match(
    source,
    /result\.status === 'unresolved'[\s\S]*?Location could not be found\.[\s\S]*?Add a city or full address and check again\./u,
  );
  const dependencyBranch = source.slice(
    source.indexOf("result.reason === 'dependency_failure'"),
    source.indexOf(
      "if (result.status === 'unresolved')",
      source.indexOf("result.reason === 'dependency_failure'"),
    ),
  );
  assert.doesNotMatch(dependencyBranch, /Add a city or full address/u);
});
