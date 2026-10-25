import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTabelogListing, readTabelogListing } from '../src/server/sources/tabelog.ts';
import { tabelogListingUrl } from '../src/shared/text.ts';
import {
  FULL_ROWS,
  LISTING_URL,
  dayRow,
  firecrawlResponse,
  listingHtml,
  row,
  stubFetch,
} from './fixtures.ts';

test('only main listing URLs are accepted, in canonical form', () => {
  assert.equal(tabelogListingUrl(`${LISTING_URL}?tracking=1#review`), LISTING_URL);
  assert.equal(tabelogListingUrl(LISTING_URL.replace('tokyo/', 'en/tokyo/')), LISTING_URL);
  assert.equal(
    tabelogListingUrl('https://tabelog.com/aomori/A0201/A020101/2000092'),
    'https://tabelog.com/aomori/A0201/A020101/2000092/',
  );
  for (const url of [
    `${LISTING_URL}dtlrvwlst/`,
    LISTING_URL.replace('tabelog.com', 'tabelog.com.evil.test'),
    'https://127.0.0.1/',
  ]) {
    assert.equal(tabelogListingUrl(url), undefined);
  }
});

test('listing facts come from the Restaurant record and its own info rows, never reviews', () => {
  const listing = parseTabelogListing(listingHtml({ rows: FULL_ROWS }), LISTING_URL)!;
  assert.equal(listing.name, '鮨 テスト');
  assert.deepEqual(listing.aliases, ['Sushi Test']);
  assert.equal(listing.address, '東京都目黒区中目黒1-1-1');
  assert.equal(listing.area, '目黒区中目黒');
  assert.equal(listing.score, 3.62);
  assert.deepEqual([listing.latitude, listing.longitude], [35.6441, 139.6988]);
  assert.deepEqual(listing.categories, ['寿司', '海鮮']);
  assert.match(listing.reservation!, /^完全予約制/u);
  assert.equal(listing.bookingUrl, 'https://yoyaku.toreta.in/sushi-test/');
  assert.equal(listing.officialUrl, 'https://sushi-test.example/');
  assert.equal(listing.introduction, '名物の穴子寿司と季節のちらし寿司をご用意しています。');
  assert.equal(listing.regularClosingDays, '日・月');
  assert.doesNotMatch(JSON.stringify(listing), /4\.99|Ignore previous|口コミ/u);
});

test('a listing without an aggregate keeps its identity; malformed or conflicting records give nothing', () => {
  assert.equal(
    parseTabelogListing(listingHtml({ record: { aggregateRating: undefined } }), LISTING_URL)
      ?.score,
    undefined,
  );
  for (const record of [
    { '@id': LISTING_URL.replace('13000001', '13000002') },
    { '@type': 'Review' },
    { aggregateRating: { '@type': 'AggregateRating', ratingValue: '9.99' } },
    { aggregateRating: { '@type': 'AggregateRating', ratingValue: true } },
    { address: {} },
  ]) {
    assert.equal(
      parseTabelogListing(listingHtml({ record }), LISTING_URL),
      undefined,
      JSON.stringify(record),
    );
  }
  const twice =
    listingHtml() +
    listingHtml({
      record: { aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.00' } },
    });
  assert.equal(parseTabelogListing(twice, LISTING_URL), undefined);
});

test('hours keep day differences and last orders; seasonal notes are not weekly closures', () => {
  const hours = (html: string) =>
    parseTabelogListing(listingHtml({ rows: row('営業時間', html) }), LISTING_URL)!;
  const dinner = hours(
    dayRow('月・火・水・木・金', '17:00 - 23:00') +
      '<p class="rstinfo-table__business-title">土・日・祝日</p><ul><li>12:00 - 14:00 L.O. 13:00</li><li>17:00 - 22:00</li></ul><div>■ 定休日<br>年末年始</div>',
  );
  assert.match(dinner.openingHours!, /12:00 - 14:00 L\.O\. 13:00/u);
  assert.equal(dinner.regularClosingDays, undefined, 'a New Year closure is not a weekly rule');
  assert.match(dinner.openingHours!, /年末年始/u);
  assert.equal(
    hours(dayRow('月・火・水・木・金', '08:15 - 14:30') + dayRow('土・日・祝日', '定休日'))
      .regularClosingDays,
    '土・日・祝日',
  );
  const weekly = hours(
    `${dayRow('月・火・水・木・金', '11:30 - 15:00')}<div class="rstinfo-table__business-other"><p>■ 定休日<br>日曜日、年末年始（12月31日～1月3日）</p></div>`,
  );
  assert.equal(
    weekly.regularClosingDays,
    '日曜日',
    'the dated New Year closure is not part of the weekly rule',
  );
  // A note about a sister branch must not replace this listing's schedule.
  const sister = hours(
    `${dayRow('月・火・水・木・金・土・日', '10:00 - 21:00')}<div class="rstinfo-table__business-other"><p>■ 営業時間<br>新宿店は東京都新宿区西新宿1-1-1 で営業</p></div>`,
  );
  assert.doesNotMatch(sister.openingHours!, /新宿店/u);
});

test('reader: Firecrawl result must be the same listing; challenges and refusals are blocked', async () => {
  const html = listingHtml({ rows: FULL_ROWS });
  const viaFirecrawl = await readTabelogListing(LISTING_URL, {
    firecrawl: true,
    fetch: stubFetch({ 'https://api.firecrawl.dev/': () => firecrawlResponse(LISTING_URL, html) }),
  });
  assert.equal(viaFirecrawl.kind === 'read' && viaFirecrawl.listing.name, '鮨 テスト');

  const redirected = await readTabelogListing(LISTING_URL, {
    firecrawl: true,
    fetch: stubFetch({
      'https://api.firecrawl.dev/': () =>
        firecrawlResponse(LISTING_URL.replace('13000001', '13000009'), html),
      'https://tabelog.com/': () => new Response('<title>現在アクセスが集中しています</title>'),
    }),
  });
  assert.equal(redirected.kind, 'blocked');

  for (const status of [403, 429]) {
    const refused = await readTabelogListing(LISTING_URL, {
      fetch: stubFetch({ 'https://tabelog.com/': () => new Response('', { status }) }),
    });
    assert.equal(refused.kind, 'blocked');
  }
});
