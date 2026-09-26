import assert from 'node:assert/strict';
import test from 'node:test';
import { createFirecrawlRestaurantReader } from './firecrawl-source-reader.ts';
const url = 'https://tabelog.com/tokyo/A1304/A130401/13004352/';
const record = {
  '@type': 'Restaurant',
  '@id': url,
  name: 'Synthetic restaurant',
  address: {
    addressRegion: 'Tokyo',
    addressLocality: 'Shinjuku',
    streetAddress: '7-9-15',
  },
  aggregateRating: { '@type': 'AggregateRating', ratingValue: '3.54' },
  geo: { latitude: 35.69, longitude: 139.69 },
  review: [{ reviewRating: { ratingValue: 4.99 } }],
};
const html = `<script type="application/ld+json">${JSON.stringify(record)}</script>`;
const data = {
  rawHtml: html,
  metadata: { url, sourceURL: url, statusCode: 200 },
};

test('fixed reader returns validated aggregate facts from fresh raw HTML without a key', async () => {
  let calls = 0;
  const reader = createFirecrawlRestaurantReader({
    fetch: async (endpoint, init) => {
      calls++;
      assert.equal(endpoint, 'https://api.firecrawl.dev/v2/scrape');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.Authorization, undefined);
      assert.deepEqual(JSON.parse(init.body), {
        url,
        formats: ['rawHtml'],
        onlyMainContent: false,
        maxAge: 0,
        timeout: 15000,
        proxy: 'basic',
      });
      return Response.json({ success: true, data });
    },
  });
  const result = await reader(
    url + '?tracking=1#fragment',
    AbortSignal.timeout(1000),
  );
  assert.equal(result.kind, 'read');
  assert.equal(result.evidence.restaurant.score, 3.54);
  assert.doesNotMatch(result.evidence.content, /4\.99/);
  assert.equal(calls, 1);
});

test('reader uses only its dedicated optional credential and rejects unsafe inputs before fetching', async () => {
  let calls = 0;
  const reader = createFirecrawlRestaurantReader({
    apiKey: 'synthetic-reader-key',
    fetch: async (endpoint, init) => {
      calls++;
      assert.equal(init.headers.Authorization, 'Bearer synthetic-reader-key');
      assert.equal(JSON.parse(init.body).headers, undefined);
      return Response.json({ success: true, data });
    },
  });
  for (const invalid of [
    'http://localhost/',
    url.replace('tabelog.com', 'tabelog.com.evil.test'),
    url + 'dtlrvwlst/B123/',
  ])
    assert.equal(
      (await reader(invalid, AbortSignal.timeout(1000))).kind,
      'invalid_source',
    );
  assert.equal(calls, 0);
  assert.equal((await reader(url, AbortSignal.timeout(1000))).kind, 'read');
  assert.equal(calls, 1);
});

test('provider quotas, redirects, malformed output, wrong branch and source challenges fail closed without retries', async () => {
  const cases = [
    [() => new Response('quota', { status: 429 }), 'unavailable'],
    [() => new Response('auth', { status: 401 }), 'unavailable'],
    [
      () =>
        new Response('', {
          status: 302,
          headers: { location: 'https://evil.test' },
        }),
      'unavailable',
    ],
    [() => Response.json({ success: false, data }), 'unavailable'],
    [
      () =>
        Response.json({
          success: true,
          data: { ...data, metadata: { ...data.metadata, statusCode: 403 } },
        }),
      'blocked',
    ],
    [
      () =>
        Response.json({
          success: true,
          data: { ...data, rawHtml: '<title>Just a moment...</title>' },
        }),
      'blocked',
    ],
    [
      () =>
        Response.json({
          success: true,
          data: {
            ...data,
            metadata: {
              ...data.metadata,
              url: url.replace('13004352', '13004353'),
            },
          },
        }),
      'invalid_source',
    ],
    [
      () =>
        Response.json({
          success: true,
          data: {
            ...data,
            metadata: { ...data.metadata, sourceURL: 'https://evil.test/' },
          },
        }),
      'invalid_source',
    ],
    [
      () =>
        Response.json({
          success: true,
          data: { ...data, rawHtml: html.replaceAll('13004352', '13004353') },
        }),
      'invalid_source',
    ],
    [
      () =>
        Response.json({
          success: true,
          data: { ...data, rawHtml: 'no restaurant' },
        }),
      'invalid_source',
    ],
    [() => new Response('bad JSON'), 'unavailable'],
    [
      () =>
        new Response('too large', { headers: { 'content-length': '3000000' } }),
      'unavailable',
    ],
  ];
  for (const [respond, expected] of cases) {
    let calls = 0;
    const reader = createFirecrawlRestaurantReader({
      fetch: async () => {
        calls++;
        return respond();
      },
    });
    assert.equal((await reader(url, AbortSignal.timeout(1000))).kind, expected);
    assert.equal(calls, 1);
  }
});

test('cancelled research starts no request and discards late source data', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  let calls = 0;
  const reader = createFirecrawlRestaurantReader({
    fetch: async () => {
      calls++;
      return Response.json({ success: true, data });
    },
  });
  assert.equal((await reader(url, cancelled.signal)).kind, 'unavailable');
  assert.equal(calls, 0);
  const late = new AbortController();
  const delayed = createFirecrawlRestaurantReader({
    fetch: async () => {
      late.abort();
      return Response.json({ success: true, data });
    },
  });
  assert.equal((await delayed(url, late.signal)).kind, 'unavailable');
});
