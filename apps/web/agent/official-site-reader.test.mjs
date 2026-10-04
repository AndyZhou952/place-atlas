import assert from 'node:assert/strict';
import test from 'node:test';

import { readOfficialSite } from './official-site-reader.ts';

test('bounded official reader finds branch contact and reservation pages on one origin', async () => {
  const urls = [];
  const pages = new Map([
    [
      'https://burntends.com.sg/',
      '<title>Burnt Ends</title><nav><a href="https://evil.example/booking">bad</a></nav><a href="/contact/">Contact</a><a href="/reservations/">Reservations</a><a href="/restaurant/">Restaurant</a><p>Burnt Ends restaurant in Singapore.</p>',
    ],
    [
      'https://burntends.com.sg/restaurant/',
      '<title>Burnt Ends Restaurant</title><p>Burnt Ends Restaurant serves modern Australian barbecue.</p><a href="/reservations/">Reserve Now</a>',
    ],
    [
      'https://burntends.com.sg/contact/',
      '<title>Contact</title><p>Burnt Ends Restaurant 7 Dempsey Road #01-02 Singapore 249671.</p><p>Burnt Ends Bar #01-04 is a separate venue.</p>',
    ],
    [
      'https://burntends.com.sg/reservations/',
      '<title>Reservations</title><p>Burnt Ends Restaurant 7 Dempsey Road #01-02 Singapore 249671. Reserve a table online.</p>',
    ],
  ]);
  const result = await readOfficialSite(
    'https://burntends.com.sg/',
    new AbortController().signal,
    async (url, init) => {
      urls.push({ url, init });
      return new Response(pages.get(url) ?? '', {
        status: pages.has(url) ? 200 : 404,
        headers: { 'content-type': 'text/html' },
      });
    },
  );
  assert.deepEqual(
    result.map((source) => source.url),
    [
      'https://burntends.com.sg/',
      'https://burntends.com.sg/restaurant/',
      'https://burntends.com.sg/contact/',
      'https://burntends.com.sg/reservations/',
    ],
  );
  assert.match(result[2].content, /#01-02 Singapore 249671/u);
  assert.match(
    result[1].content,
    /Reserve Now: https:\/\/burntends\.com\.sg\/reservations\//u,
  );
  assert.equal(
    urls.every(({ init }) => init.redirect === 'manual'),
    true,
  );
});

test('official reader rejects private and redirected destinations', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example/' },
    });
  };
  assert.deepEqual(
    await readOfficialSite(
      'https://127.0.0.1/',
      new AbortController().signal,
      fetcher,
    ),
    [],
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await readOfficialSite(
      'https://burntends.com.sg/',
      new AbortController().signal,
      fetcher,
    ),
    [],
  );
  assert.equal(calls, 1);
});
test('booking anchors preserve required query parameters and client-side routes', async () => {
  const sources = await readOfficialSite(
    'https://restaurant.example/branch',
    new AbortController().signal,
    async () =>
      new Response(
        '<title>Restaurant Branch</title><p>Restaurant Branch Tokyo 3-5-1</p><a href="https://booking.example/shop?venue=123&amp;service=dinner#/reserve">予約する</a>',
        { headers: { 'content-type': 'text/html' } },
      ),
  );
  assert.deepEqual(sources[0].bookingLinks, [
    {
      label: '予約する',
      url: 'https://booking.example/shop?venue=123&service=dinner#/reserve',
    },
  ]);
  assert.match(sources[0].content, /service=dinner#\/reserve/u);
});
test('structured official hours belong only to the page restaurant, not a sister branch', async () => {
  const url = 'https://restaurant.example/nakameguro';
  const record = {
    '@type': 'Restaurant',
    url,
    name: 'RODEO NAKAMEGURO',
    address: {
      addressRegion: '東京都',
      addressLocality: '目黒区',
      streetAddress: '中目黒3-5-1',
    },
    openingHoursSpecification: [
      { dayOfWeek: ['Monday', 'Friday'], opens: '17:00', closes: '23:00' },
      {
        dayOfWeek: ['Saturday', 'Sunday', 'PublicHolidays'],
        opens: '12:00',
        closes: '14:00',
      },
    ],
  };
  for (const wrongBranch of [false, true]) {
    const source = {
      ...record,
      url: wrongBranch ? 'https://restaurant.example/shibuya' : url,
    };
    const pages = await readOfficialSite(
      url,
      new AbortController().signal,
      async () =>
        new Response(
          `<p>Public restaurant information</p><script type="application/ld+json">${JSON.stringify(source)}</script>`,
          { headers: { 'content-type': 'text/html' } },
        ),
      1,
    );
    assert.equal(
      pages[0].operatingHours,
      wrongBranch
        ? undefined
        : '月・金 17:00 - 23:00; 土・日・祝日 12:00 - 14:00',
    );
    if (!wrongBranch)
      assert.match(
        pages[0].content,
        /RODEO NAKAMEGURO 東京都目黒区中目黒3-5-1/u,
      );
  }
});
