import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenSource = await readFile(
  new URL('./atlas-screen.tsx', import.meta.url),
  'utf8',
);
const viewModelSource = await readFile(
  new URL('./use-atlas-view-model.ts', import.meta.url),
  'utf8',
);
const cssSource = await readFile(
  new URL('../../app/globals.css', import.meta.url),
  'utf8',
);

void test('Nearby uses a labelled manual location form and never requests browser geolocation', () => {
  assert.match(screenSource, /<form[^>]*className="nearby-search"/u);
  assert.match(screenSource, /htmlFor="nearby-location"/u);
  assert.match(screenSource, /id="nearby-location"/u);
  assert.match(
    screenSource,
    /placeholder="e\.g\. 銀座, Ginza, or a copied address"/u,
  );
  assert.match(viewModelSource, /key: 'nearby\.recommend'/u);
  assert.doesNotMatch(viewModelSource, /navigator\.geolocation/u);
  assert.doesNotMatch(viewModelSource, /key: 'decision\.nearby'/u);
});

void test('Nearby exposes loading, error, ambiguous, empty, and resolved states accessibly', () => {
  assert.match(screenSource, /aria-busy=\{vm\.nearbyBusy\}/u);
  assert.match(screenSource, /role="alert"/u);
  assert.match(screenSource, /Choose a more specific location/u);
  assert.match(
    screenSource,
    /No saved places are reachable from this location yet\./u,
  );
  assert.match(screenSource, /Searching saved places…/u);
  assert.match(screenSource, /<ol className="nearby-results"/u);
  assert.match(
    cssSource,
    /\.nearby-search \[data-slot='input'\][\s\S]*min-height:\s*2\.75rem/u,
  );
});

void test('resolved Nearby presents ordered route, personal, warning, and provider evidence without feeding route payloads to Leaflet', () => {
  assert.match(screenSource, /result\.recommendations\.map/u);
  assert.match(screenSource, /candidate\.route\.durationMinutes/u);
  assert.match(screenSource, /candidate\.visit\.visitCount/u);
  assert.match(screenSource, /candidate\.visit\.personalRating/u);
  assert.match(screenSource, /candidate\.warnings/u);
  assert.match(screenSource, /attribution=\{result\.attribution\}/u);
  assert.match(screenSource, /result\.provenance\.checkedAt/u);
  assert.match(screenSource, /attribution=\{candidate\.route\.source\}/u);
  assert.match(screenSource, /candidate\.route\.checkedAt/u);
  assert.match(screenSource, /\{attribution\.label\}/u);
  assert.doesNotMatch(screenSource, /<AtlasMap[^>]*(nearby|route|origin)/u);
});

void test('Nearby reuses the canonical visited policy and keeps evidence in the empty resolved state', () => {
  assert.match(
    screenSource,
    /import \{ isEffectivelyVisited \} from ['"]@\/product\/application\/assessments\/effective-visited['"]/u,
  );
  assert.match(
    screenSource,
    /isEffectivelyVisited\(\s*candidate\.visit\.manualVisited,\s*candidate\.visit\.visitCount,?\s*\)/u,
  );
  assert.doesNotMatch(
    screenSource,
    /candidate\.visit\.manualVisited\s*\|\|\s*candidate\.visit\.visitCount\s*>\s*0/u,
  );
  assert.match(
    screenSource,
    /No saved places are reachable[\s\S]*?<ProviderEvidence[\s\S]*?attribution=\{result\.attribution\}[\s\S]*?checkedAt=\{result\.provenance\.checkedAt\}[\s\S]*?sourceUrl=\{result\.provenance\.sourceUrl\}/u,
  );
});

void test('provider attribution links to its public URL and exposes the technical source separately', () => {
  assert.match(screenSource, /<a href=\{attribution\.url\}/u);
  assert.doesNotMatch(
    screenSource,
    /<a href=\{sourceUrl \|\| attribution\.url\}/u,
  );
  assert.match(screenSource, /source \{formatProviderSource\(sourceUrl\)\}/u);
});

void test('a new Nearby query clears distances from the previous location before any outcome', () => {
  assert.match(
    viewModelSource,
    /const normalizedLocationHint = locationHint\.trim\(\);[\s\S]*?setDistances\(\{\}\);[\s\S]*?if \(!normalizedLocationHint\)/u,
  );
});
