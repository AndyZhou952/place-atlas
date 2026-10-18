import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWebSearch,
  parseDuckDuckGoHtml,
  parseYahooJapanHtml,
} from './web-search.ts';

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

test('Japanese research uses a bounded public Yahoo search without forwarding credentials', async () => {
  const html = `<div id="web"><ol><li><a href="${url}"><b>Restaurant</b></a><div>Address &amp; facts</div></li><li><a href="https://127.0.0.1/">Unsafe</a></li></ol></div>`;
  assert.deepEqual(parseYahooJapanHtml(html), {
    kind: 'results',
    sources: [
      { url, title: 'Restaurant', content: 'Restaurant\nAddress & facts' },
    ],
  });
  const calls = [];
  const port = createWebSearch({
    fetch: async (endpoint, init) => {
      calls.push(endpoint);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.Authorization, undefined);
      return new Response(html);
    },
  });
  assert.equal(
    (await port.search('東京麺通団', new AbortController().signal)).kind,
    'results',
  );
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).origin, 'https://search.yahoo.co.jp');
  assert.equal(
    parseYahooJapanHtml('<form id="captcha"></form>').reason,
    'blocked',
  );
  assert.equal(
    parseYahooJapanHtml('<html>changed layout</html>').reason,
    'invalid_response',
  );
});

test('Japanese research falls back to bounded DuckDuckGo evidence when Yahoo is blocked', async () => {
  const calls = [];
  const search = createWebSearch({
    fetch: async (endpoint, init) => {
      calls.push(new URL(endpoint).origin);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.Authorization, undefined);
      return new URL(endpoint).hostname === 'search.yahoo.co.jp'
        ? new Response('', { status: 403 })
        : new Response(fixture);
    },
  });
  const result = await search.search(
    'アルデバラン site:tabelog.com',
    AbortSignal.timeout(1000),
  );
  assert.equal(result.kind, 'results');
  assert.equal(result.sources[0].url, url);
  assert.deepEqual(calls, [
    'https://search.yahoo.co.jp',
    'https://html.duckduckgo.com',
  ]);
});

test('two blocked no-key sources remain unavailable and cannot invent a listing', async () => {
  let calls = 0;
  const search = createWebSearch({
    fetch: async () => {
      calls++;
      return new Response('', { status: 403 });
    },
  });
  assert.deepEqual(
    await search.search(
      '東京麺通団 site:tabelog.com',
      AbortSignal.timeout(1000),
    ),
    { kind: 'unavailable', reason: 'blocked' },
  );
  assert.equal(calls, 2);
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
    (await search.search('restaurant', new AbortController().signal)).kind,
    'results',
  );
  assert.equal(
    new URL(requests[0].endpoint).origin,
    'https://html.duckduckgo.com',
  );
  assert.equal(requests[0].init.redirect, 'manual');
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

test('a stalled primary search is aborted early enough to use the fallback', async () => {
  const calls = [];
  const parent = new AbortController();
  const keepAlive = setTimeout(() => {}, 6000);
  try {
    const search = createWebSearch({
      fetch: async (endpoint, init) => {
        calls.push(new URL(endpoint).origin);
        if (new URL(endpoint).hostname === 'search.yahoo.co.jp') {
          assert.notEqual(init.signal, parent.signal);
          await new Promise((resolve, reject) =>
            init.signal.addEventListener(
              'abort',
              () => reject(init.signal.reason),
              { once: true },
            ),
          );
        }
        init.signal.throwIfAborted();
        return new Response(fixture);
      },
    });
    const result = await search.search(
      '架空の店 site:tabelog.com',
      parent.signal,
    );
    assert.equal(result.kind, 'results');
    assert.equal(result.sources[0].url, url);
    assert.equal(parent.signal.aborted, false);
    assert.deepEqual(calls, [
      'https://search.yahoo.co.jp',
      'https://html.duckduckgo.com',
    ]);
  } finally {
    clearTimeout(keepAlive);
  }
});
