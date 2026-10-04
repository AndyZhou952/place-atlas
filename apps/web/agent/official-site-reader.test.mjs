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

test('explicit closure is extracted only from the matching branch labeled row', async () => {
  const url = 'https://gonokamiseisakusho.com/shinjyuku.html';
  const branch = {
    '@type': 'Restaurant',
    url,
    name: 'つけ麺 五ノ神製作所',
    address: {
      addressRegion: '東京都',
      addressLocality: '渋谷区',
      streetAddress: '千駄ヶ谷5-33-16',
    },
    openingHoursSpecification: [
      {
        dayOfWeek: [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ],
        opens: '11:00',
        closes: '21:30',
      },
    ],
  };
  const read = async ({
    record = branch,
    row = '<tr><th>定休日</th><td>無し</td></tr>',
    expectedBranch,
  } = {}) => {
    const html = `<title>つけ麺 五ノ神製作所</title><p>東京都渋谷区千駄ヶ谷5-33-16</p>${row}<script type="application/ld+json">${JSON.stringify(record)}</script>`;
    const pages = await readOfficialSite(
      url,
      new AbortController().signal,
      async () =>
        new Response(html, { headers: { 'content-type': 'text/html' } }),
      1,
      expectedBranch,
    );
    return pages[0];
  };

  const source = await read({
    expectedBranch: {
      name: branch.name,
      address: '東京都渋谷区千駄ヶ谷5-33-16 シャトレー新宿御苑第一 1F',
    },
  });
  assert.equal(source.regularClosingDays, '無し');
  assert.match(source.content, /Official regular closing days: 無し/u);

  const siblingOnly = await read({
    record: { ...branch, url: 'https://gonokamiseisakusho.com/gotanda.html' },
  });
  assert.equal(siblingOnly.regularClosingDays, undefined);

  const ambiguousSibling = await read({
    record: [
      branch,
      {
        ...branch,
        url: 'https://gonokamiseisakusho.com/gotanda.html',
        name: '五ノ神製作所 五反田店',
        address: {
          addressRegion: '東京都',
          addressLocality: '品川区',
          streetAddress: '西五反田1-25-5',
        },
      },
    ],
    expectedBranch: {
      name: branch.name,
      address: '東京都渋谷区千駄ヶ谷5-33-16',
    },
  });
  assert.equal(ambiguousSibling.regularClosingDays, undefined);

  const mismatchedExactPageRecord = await read({
    record: {
      ...branch,
      name: '別の五ノ神店舗',
      address: {
        addressRegion: '東京都',
        addressLocality: '品川区',
        streetAddress: '西五反田1-25-5',
      },
    },
    expectedBranch: {
      name: branch.name,
      address: '東京都渋谷区千駄ヶ谷5-33-16',
    },
  });
  assert.equal(mismatchedExactPageRecord.regularClosingDays, undefined);

  const unlabeled = await read({ row: '<p>定休日 無し</p>' });
  assert.equal(unlabeled.regularClosingDays, undefined);

  const seasonalOnly = await read({
    row: '<tr><th>定休日</th><td>年末年始</td></tr>',
  });
  assert.equal(seasonalOnly.regularClosingDays, undefined);

  const summerOnly = await read({
    row: '<tr><th>定休日</th><td>夏季休業</td></tr>',
  });
  assert.equal(summerOnly.regularClosingDays, undefined);

  const calendarOnly = await read({
    row: '<tr><th>定休日</th><td>夏季休業（8月12日）</td></tr>',
  });
  assert.equal(calendarOnly.regularClosingDays, undefined);

  const overlong = await read({
    row: `<tr><th>定休日</th><td>${'不定休'.repeat(100)}</td></tr>`,
  });
  assert.equal(overlong.regularClosingDays, undefined);
});

test('official branch microsite without JSON-LD uses supplied Tabelog identity', async () => {
  const url = 'https://gonokamiseisakusho.com/shinjyuku.html';
  const html = `<title>つけ麺 五ノ神製作所</title><h2>つけ麺 五ノ神製作所</h2><table><tr><td>住所</td><td>東京都渋谷区千駄ヶ谷5-33-16</td></tr><tr><td>営業時間</td><td>11:00～21:30(L.O 21:00)</td></tr><tr><td>定休日</td><td>無し</td></tr></table>`;
  const fetcher = async () =>
    new Response(html, { headers: { 'content-type': 'text/html' } });
  const expectedBranch = {
    name: 'つけ麺 五ノ神製作所',
    address: '東京都渋谷区千駄ヶ谷5-33-16 シャトレー新宿御苑第一 1F',
  };
  const read = (identity) =>
    readOfficialSite(url, new AbortController().signal, fetcher, 1, identity);

  const matched = await read(expectedBranch);
  assert.equal(matched[0].regularClosingDays, '無し');

  const readMarkup = (pageHtml, identity) =>
    readOfficialSite(
      url,
      new AbortController().signal,
      async () =>
        new Response(pageHtml, {
          headers: { 'content-type': 'text/html' },
        }),
      1,
      identity,
    );

  const wrongCity = await readMarkup(
    html.replace('東京都渋谷区千駄ヶ谷5-33-16', '東京都品川区千駄ヶ谷5-33-16'),
    expectedBranch,
  );
  assert.equal(wrongCity[0].regularClosingDays, undefined);

  const extendedNumber = await readMarkup(
    html.replace('千駄ヶ谷5-33-16</td>', '千駄ヶ谷5-33-160</td>'),
    expectedBranch,
  );
  assert.equal(extendedNumber[0].regularClosingDays, undefined);

  const duplicatedBranchAddress = html.replace(
    '</table>',
    '<tr><td>住所</td><td>東京都品川区西五反田1-25-5</td></tr></table>',
  );
  const ambiguous = await readMarkup(duplicatedBranchAddress, expectedBranch);
  assert.equal(ambiguous[0].regularClosingDays, undefined);
});
