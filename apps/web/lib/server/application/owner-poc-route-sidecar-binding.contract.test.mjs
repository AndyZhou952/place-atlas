import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dbSourceUrl = new URL('../../../db/index.ts', import.meta.url);
const serverApplicationUrl = new URL(
  './server-atlas-application.ts',
  import.meta.url,
);
const providerManifestUrl = new URL(
  './catalog-intake-provider-mode-manifest.ts',
  import.meta.url,
);

void test('Browser owner composition receives the private Route Sidecar and shared Add runtime', async () => {
  const [dbSource, serverSource, providerManifest] = await Promise.all([
    readFile(dbSourceUrl, 'utf8'),
    readFile(serverApplicationUrl, 'utf8'),
    readFile(providerManifestUrl, 'utf8'),
  ]);

  assert.match(
    dbSource,
    /export function getRouteSidecarServiceBinding\(\)[\s\S]*?ROUTE_SIDECAR/u,
  );
  assert.match(
    serverSource,
    /createOwnerPocComposition\(\s*database,\s*getRouteSidecarServiceBinding\(\),\s*getOwnerPocCatalogIntakeRuntime\(\),?\s*\)/u,
  );
  assert.match(dbSource, /projectOwnerPocCatalogIntakeRuntime\(env\)/u);
  assert.match(providerManifest, /GOOGLE_PLACES_API_KEY/u);
  assert.doesNotMatch(
    `${dbSource}\n${serverSource}`,
    /GOOGLE_MAPS_API_KEY|NAVITIME_RAPIDAPI_KEY|foursquare/iu,
  );
});
