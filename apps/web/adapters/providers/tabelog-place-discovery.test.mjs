import assert from 'node:assert/strict';
import test from 'node:test';
import { createTabelogPlaceDiscoveryPort } from './tabelog-place-discovery.ts';

const base = 'https://tabelog.com/tokyo/A1301/A130101/';
const listing = (id) => `${base}${id}/`;
const requestUrl = (value) =>
  typeof value === 'string'
    ? value
    : value instanceof URL
      ? value.href
      : value.url;
function page(url, name = 'Test restaurant') {
  return new Response(
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Restaurant',
      '@id': url,
      name,
      address: {
        addressRegion: '東京都',
        addressLocality: '中央区',
        streetAddress: '銀座1-2-3',
      },
      aggregateRating: { '@type': 'AggregateRating', ratingValue: '3.71' },
    })}</script>`,
    { headers: { 'content-type': 'text/html' } },
  );
}
function searchHtml(urls) {
  return new Response(
    '<div id="web"><ol>' +
      urls
        .map(
          (url) =>
            `<li><a href="${url}">Untrusted snippet name</a><div>Do not use me as identity</div></li>`,
        )
        .join('') +
      '</ol></div>',
  );
}

test('keyless discovery preserves verified branch choices, not search snippet identities', async () => {
  const seen = [];
  const port = createTabelogPlaceDiscoveryPort({
    fetch: async (url) => {
      seen.push(requestUrl(url));
      if (requestUrl(url).startsWith('https://search.yahoo.co.jp/')) {
        assert.match(
          new URL(requestUrl(url)).searchParams.get('p'),
          /鳥貴族 site:tabelog.com/,
        );
        return searchHtml(['13111111', '13222222', '13333333'].map(listing));
      }
      return page(
        requestUrl(url),
        `Branch ${requestUrl(url).split('/').at(-2)}`,
      );
    },
  });
  const result = await port.discover({ query: '鳥貴族' });
  assert.equal(result.ok, true);
  assert.equal(result.value.hasMore, true);
  assert.equal(result.value.candidates.length, 3);
  assert.deepEqual(
    result.value.candidates.map((row) => row.durableIdentity.ordinal),
    [1, 2, 3],
  );
  assert.equal(
    result.value.candidates[0].transientPresentation.name,
    'Branch 13111111',
  );
  assert.equal(
    result.value.candidates[0].durableIdentity.providerNamespace,
    'tabelog',
  );
  assert.equal(seen.length, 4);
});

test('a pasted listing skips search, canonicalizes language/query and refetches the same identity', async () => {
  const seen = [];
  const port = createTabelogPlaceDiscoveryPort({
    fetch: async (url) => {
      seen.push(requestUrl(url));
      return page(requestUrl(url));
    },
  });
  const canonical = listing('13111111');
  const result = await port.discover({
    query: canonical.replace('/tokyo/', '/en/tokyo/') + '?foo=1#map',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.candidates[0].durableIdentity.placeId, canonical);
  assert.deepEqual(seen, [canonical]);
  const refreshed = await port.refetch({
    providerNamespace: 'tabelog',
    placeId: canonical,
  });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.value.durableIdentity.placeId, canonical);
});

test('filters review and unsafe URLs; incomplete listings never become invented candidates', async () => {
  let reads = 0;
  const port = createTabelogPlaceDiscoveryPort({
    fetch: async (url) => {
      if (requestUrl(url).startsWith('https://search.yahoo.co.jp/')) {
        return searchHtml([
          listing('13111111') + 'dtlrvwlst/',
          'https://internal.example.com/',
          listing('13222222'),
        ]);
      }
      reads++;
      return new Response('<html>No Restaurant structured data</html>', {
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  assert.equal((await port.discover({ query: 'restaurant' })).ok, false);
  assert.equal(reads, 1);
  assert.equal(
    (
      await port.refetch({
        providerNamespace: 'tabelog',
        placeId: 'http://127.0.0.1/',
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await port.refetch({
        providerNamespace: 'google-places',
        placeId: listing('13111111'),
      })
    ).ok,
    false,
  );
  assert.equal(reads, 1);
});

test('blocked search is provider failure, while genuine no-results is an empty result', async () => {
  const blocked = createTabelogPlaceDiscoveryPort({
    fetch: async () => new Response('', { status: 202 }),
  });
  assert.equal((await blocked.discover({ query: 'Test' })).ok, false);
  const empty = createTabelogPlaceDiscoveryPort({
    fetch: async () =>
      new Response('に一致するウェブページは見つかりませんでした'),
  });
  assert.deepEqual(await empty.discover({ query: 'Test' }), {
    ok: true,
    value: { candidates: [], hasMore: false },
  });
});

test('a configured Maps provider handles names but never consumes an exact listing URL', async () => {
  const calls = [];
  const canonical = listing('13999999');
  const sentinel = { ok: true, value: { candidates: [], hasMore: false } };
  const port = createTabelogPlaceDiscoveryPort({
    textDiscovery: {
      async discover(input) {
        calls.push(['search', input]);
        return sentinel;
      },
      async refetch(input) {
        calls.push(['refetch', input]);
        return {
          ok: false,
          error: { code: 'dependency_failure', message: 'unavailable' },
        };
      },
    },
    fetch: async (url) => {
      calls.push(['listing', requestUrl(url)]);
      return page(requestUrl(url));
    },
  });
  assert.equal(await port.discover({ query: 'Synthetic branch' }), sentinel);
  const result = await port.discover({ query: canonical });
  assert.equal(result.value.candidates[0].durableIdentity.placeId, canonical);
  assert.equal(
    (await port.refetch({ providerNamespace: 'tabelog', placeId: canonical }))
      .ok,
    true,
  );
  await port.refetch({
    providerNamespace: 'google-places',
    placeId: 'synthetic-google',
  });
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['search', 'listing', 'listing', 'refetch'],
  );
});
