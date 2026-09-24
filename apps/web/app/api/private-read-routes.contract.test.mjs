import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routePaths = ['./nearby/route.ts', './media/route.ts'];

void test('non-public v1 GET routes are owner guarded before application composition', async () => {
  for (const routePath of routePaths) {
    const source = await readFile(new URL(routePath, import.meta.url), 'utf8');
    assert.match(source, /export const GET = withOwnerReadAuth/u, routePath);
    assert.doesNotMatch(source, /export async function GET/u, routePath);
    assert.ok(
      source.indexOf('withOwnerReadAuth(async function GET') <
        source.indexOf(
          'getServerAtlasApplication()',
          source.indexOf('export const GET'),
        ),
      `${routePath} must authorize before composing the application`,
    );
  }
});
