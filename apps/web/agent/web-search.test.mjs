import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebSearch, parseDuckDuckGoHtml } from './web-search.ts';

const url = 'https://tabelog.com/tokyo/A1307/A130702/13212345/';
const fixture = `<html><div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&amp;rut=abc">アルデバラン &amp; Burger</a></h2><div class="result__extras">Tabelog</div><a href="${url}" class="result__snippet">麻布十番 <b>3.97</b> &#x4e88;約</a></div></html>`;

test('parses encoded result URLs and plain text without following result links', () => {
  assert.deepEqual(parseDuckDuckGoHtml(fixture), {
    kind: 'results',
    sources: [
      {
        url,
        title: 'アルデバラン & Burger',
        content: 'アルデバラン & Burger\n麻布十番 3.97 予約',
      },
    ],
  });
});

test('no-key search uses one fixed endpoint and rejects challenge without retrying', async () => {
  const requests = [];
  const search = createWebSearch({
    fetch: async (endpoint, init) => {
      requests.push({ endpoint, init });
      return new Response(fixture);
    },
  });
  assert.equal(
    (await search.search('アルデバラン', new AbortController().signal)).kind,
    'results',
  );
  assert.equal(
    new URL(requests[0].endpoint).origin,
    'https://html.duckduckgo.com',
  );
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(requests.length, 1);
  let calls = 0;
  const blocked = createWebSearch({
    fetch: async () => {
      calls++;
      return new Response('<form id="challenge-form"></form>', { status: 202 });
    },
  });
  assert.deepEqual(
    await blocked.search('restaurant', new AbortController().signal),
    { kind: 'unavailable', reason: 'blocked' },
  );
  assert.equal(calls, 1);
  assert.equal(
    parseDuckDuckGoHtml('<div class="anomaly-modal">challenge</div>').reason,
    'blocked',
  );
});

test('internal links and malformed or oversized provider bodies fail closed', async () => {
  for (const target of [
    'http://127.0.0.1/',
    'https://127.0.0.1/',
    'https://service.internal/',
    'https://user:secret@example.com/',
  ]) {
    const html = fixture.replace(
      encodeURIComponent(url),
      encodeURIComponent(target),
    );
    assert.equal(parseDuckDuckGoHtml(html).kind, 'unavailable');
  }
  const search = createWebSearch({
    fetch: async () => new Response('x'.repeat(262_145)),
  });
  assert.equal(
    (await search.search('restaurant', new AbortController().signal)).kind,
    'unavailable',
  );
});

test('empty search results are distinct from unexpected HTML', () => {
  assert.deepEqual(
    parseDuckDuckGoHtml('<div class="no-results">No results found</div>'),
    { kind: 'results', sources: [] },
  );
  assert.equal(
    parseDuckDuckGoHtml('<html>provider changed</html>').reason,
    'invalid_response',
  );
});

test('explicit key selects Tavily and never sends that key to DuckDuckGo', async () => {
  const search = createWebSearch({
    apiKey: 'test-search-key',
    fetch: async (endpoint, init) => {
      assert.equal(endpoint, 'https://api.tavily.com/search');
      assert.equal(init.headers.Authorization, 'Bearer test-search-key');
      return Response.json({
        results: [{ url, title: 'Aldebaran', content: 'restaurant' }],
      });
    },
  });
  assert.equal(
    (await search.search('restaurant', new AbortController().signal)).sources
      .length,
    1,
  );
});
