import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dbSourceUrl = new URL('../../../db/index.ts', import.meta.url);
const serverApplicationUrl = new URL(
  './server-atlas-application.ts',
  import.meta.url,
);

void test('Browser owner composition receives the same optional private Route Sidecar binding', async () => {
  const [dbSource, serverSource] = await Promise.all([
    readFile(dbSourceUrl, 'utf8'),
    readFile(serverApplicationUrl, 'utf8'),
  ]);

  assert.match(
    dbSource,
    /export function getRouteSidecarServiceBinding\(\)[\s\S]*?ROUTE_SIDECAR/u,
  );
  assert.match(
    serverSource,
    /createOwnerPocComposition\(\s*database,\s*getRouteSidecarServiceBinding\(\),?\s*\)/u,
  );
  assert.doesNotMatch(
    `${dbSource}\n${serverSource}`,
    /GOOGLE_MAPS_API_KEY|transit|foursquare/iu,
  );
});
