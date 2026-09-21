import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routeUrl = new URL('./route.ts', import.meta.url);

void test('Agent route selects canonical owner composition without giving it a Google key', async () => {
  const source = await readFile(routeUrl, 'utf8');
  const ownerBranch = source.match(
    /if \(deployment\.ATLAS_DEPLOYMENT_ENV === 'owner-poc'\)([\s\S]*?)\n  \}/u,
  )?.[1];

  assert.ok(ownerBranch);
  assert.match(ownerBranch, /createOwnerPocComposition\(bindings\.DB\)/u);
  assert.match(ownerBranch, /createServerAtlasApplication/u);
  assert.match(ownerBranch, /createOwnerPocAgentHttpHandler/u);
  assert.doesNotMatch(ownerBranch, /GOOGLE_MAPS_API_KEY|transit|foursquare/iu);
  assert.match(source, /createT06aGoogleNearbyComposition/u);
});
