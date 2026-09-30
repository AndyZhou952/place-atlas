import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screen = await readFile(
  new URL('./atlas-screen.tsx', import.meta.url),
  'utf8',
);
const search = await readFile(
  new URL('./recommend-search.tsx', import.meta.url),
  'utf8',
);
const service = await readFile(
  new URL(
    '../../product/application/decision/recommend-conversation-service.ts',
    import.meta.url,
  ),
  'utf8',
);
const css = await readFile(
  new URL('../../app/globals.css', import.meta.url),
  'utf8',
);

test('Map exposes one natural-language Recommend field without browser geolocation', () => {
  assert.match(screen, /<RecommendSearch onSelect=\{vm\.selectItem\}/u);
  assert.match(screen, /Ask Recommend/u);
  assert.match(search, /<form className="nearby-search"/u);
  assert.match(search, /htmlFor="nearby-location"/u);
  assert.match(search, /id="nearby-location"/u);
  assert.match(search, /key: 'recommend\.ask'/u);
  assert.doesNotMatch(search, /navigator\.geolocation/u);
  assert.match(
    css,
    /\.nearby-search \[data-slot='input'\][\s\S]*min-height:\s*2\.75rem/u,
  );
});

test('clarification stays in the same panel with choices, free text and keyboard submit', () => {
  assert.match(search, /result\?\.status === 'clarify'/u);
  assert.match(search, /<fieldset className="recommend-choices"/u);
  assert.match(
    search,
    /<form className="nearby-search" onSubmit=\{submitReply\}/u,
  );
  assert.match(search, /appendRecommendReply\(active, reply\)/u);
  assert.match(search, /appendRecommendChoice\(/u);
  assert.match(search, /result\.originHint/u);
  assert.match(search, /appendRecommendReply\(active, option\.label\)/u);
  assert.match(search, /Start over/u);
  assert.match(
    css,
    /\.recommend-choices \[data-slot='button'\][\s\S]*min-height:\s*2\.75rem/u,
  );
});

test('provider failure keeps the draft for retry while empty results remain distinct', () => {
  assert.match(search, /result\?\.status === 'unavailable'/u);
  assert.match(search, /onClick=\{\(\) => active && void ask\(active\)\}/u);
  assert.match(search, /result\?\.status === 'no_results'/u);
  assert.match(service, /resolution\.reason === 'dependency_failure'/u);
  assert.match(service, /return unavailable\(\)/u);
});

test('recommendation rows expose a reason and open the exact saved item detail', () => {
  assert.match(search, /result\.recommendations\.map/u);
  assert.match(search, /onSelect\(candidate\.detailTargetId\)/u);
  assert.match(search, /candidate\.reason/u);
  assert.match(search, /candidate\.warnings/u);
  assert.doesNotMatch(screen, /<AtlasMap[^>]*(nearby|route|origin)/u);
});
