import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBrowserRestaurantReader,
  createRestaurantSourceReader,
} from './browser-source-reader.ts';
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
  servesCuisine: 'うどん',
};
const html = `<script type="application/ld+json">${JSON.stringify(record)}</script>`;
test('direct success and invalid pages do not incur browser work; denied reads have one fallback', async () => {
  let renders = 0;
  const browser = {
    async quickAction() {
      renders++;
      return Response.json({ success: true, result: html });
    },
  };
  const signal = AbortSignal.timeout(1000);
  const direct = createRestaurantSourceReader(
    browser,
    async () =>
      new Response(html, { headers: { 'content-type': 'text/html' } }),
  );
  assert.equal((await direct(url, signal)).kind, 'read');
  assert.equal(renders, 0);
  const invalid = createRestaurantSourceReader(
    browser,
    async () =>
      new Response('<html>Not a restaurant</html>', {
        headers: { 'content-type': 'text/html' },
      }),
  );
  assert.equal((await invalid(url, signal)).kind, 'invalid_source');
  assert.equal(renders, 0);
  const denied = createRestaurantSourceReader(
    browser,
    async () => new Response('Denied', { status: 403 }),
  );
  assert.equal((await denied(url, signal)).kind, 'read');
  assert.equal(renders, 1);
  const challenged = createRestaurantSourceReader(
    browser,
    async () =>
      new Response('<title>Just a moment...</title>', {
        headers: { 'content-type': 'text/html' },
      }),
  );
  assert.equal((await challenged(url, signal)).kind, 'read');
  assert.equal(renders, 2);
  const unavailable = createRestaurantSourceReader(
    {
      async quickAction() {
        throw Error('down');
      },
    },
    async () => new Response('Denied', { status: 403 }),
  );
  assert.equal((await unavailable(url, signal)).kind, 'blocked');
});
test('browser reader returns only validated restaurant facts with fixed host and bounded browser work', async () => {
  let calls = 0;
  const reader = createBrowserRestaurantReader({
    async quickAction(action, options) {
      calls++;
      assert.equal(action, 'content');
      assert.equal(options.url, url);
      assert.deepEqual(options.allowRequestPattern, [
        '^https://tabelog\\.com/',
      ]);
      assert.equal(options.gotoOptions.timeout, 12000);
      assert.equal(options.cookies, undefined);
      assert.equal(options.authenticate, undefined);
      return Response.json({ success: true, result: html });
    },
  });
  const result = await reader(
    url + '?tracking=1#review',
    AbortSignal.timeout(1000),
  );
  assert.equal(result.kind, 'read');
  assert.equal(result.evidence.restaurant.score, 3.54);
  for (const invalid of [
    'https://localhost/',
    url.replace('tabelog.com', 'tabelog.com.evil.test'),
    url + 'dtlrvwlst/B123/',
  ])
    assert.deepEqual(await reader(invalid, AbortSignal.timeout(1000)), {
      kind: 'invalid_source',
    });
  assert.equal(calls, 1);
});
test('browser API success is not source success: challenge, malformed, wrong branch and oversized body fail closed', async () => {
  const cases = [
    [
      () =>
        Response.json({
          success: true,
          result: '<title>Just a moment...</title>',
        }),
      'blocked',
    ],
    [
      () =>
        Response.json({
          success: true,
          result: '<title>現在アクセスが集中しています [食べログ]</title>',
        }),
      'blocked',
    ],
    [
      () =>
        Response.json({
          success: true,
          result: html.replaceAll('13004352', '13004353'),
        }),
      'invalid_source',
    ],
    [() => Response.json({ success: false, result: html }), 'unavailable'],
    [() => new Response('denied', { status: 403 }), 'blocked'],
    [
      () => new Response('x', { headers: { 'content-length': '3000000' } }),
      'unavailable',
    ],
    [() => new Response('not JSON'), 'unavailable'],
  ];
  for (const [response, kind] of cases) {
    let calls = 0;
    const reader = createBrowserRestaurantReader({
      async quickAction() {
        calls++;
        return response();
      },
    });
    assert.deepEqual(await reader(url, AbortSignal.timeout(1000)), { kind });
    assert.equal(calls, 1);
  }
});
test('aborted request never starts a browser and late evidence is discarded', async () => {
  const controller = new AbortController();
  controller.abort();
  const reader = createBrowserRestaurantReader({
    async quickAction() {
      throw Error('must not execute');
    },
  });
  assert.deepEqual(await reader(url, controller.signal), {
    kind: 'unavailable',
  });
  const late = new AbortController();
  const delayed = createBrowserRestaurantReader({
    async quickAction() {
      late.abort();
      return Response.json({ success: true, result: html });
    },
  });
  assert.deepEqual(await delayed(url, late.signal), { kind: 'unavailable' });
});
