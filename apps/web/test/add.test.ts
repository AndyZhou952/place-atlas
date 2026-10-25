import assert from 'node:assert/strict';
import test from 'node:test';
import { discover, parseDraft, preview, reservationFromListing } from '../src/server/agent/add.ts';
import { HttpError } from '../src/server/http.ts';
import type { Restaurant } from '../src/shared/types.ts';
import {
  FULL_ROWS,
  LISTING_URL,
  chatResponse,
  firecrawlResponse,
  listingHtml,
  stubFetch,
  yahooHtml,
} from './fixtures.ts';

const model = { apiKey: 'test-key', baseUrl: 'https://model.test/v1', model: 'test' };
const OTHER = 'https://tabelog.com/tokyo/A1317/A131701/13000002/';

function sources(chat?: (body: { messages: { content: string }[] }) => Response) {
  return {
    firecrawl: true,
    model,
    fetch: stubFetch({
      'https://search.yahoo.co.jp/': () =>
        new Response(
          yahooHtml([
            `${LISTING_URL}dtlrvwlst/`,
            LISTING_URL,
            `${OTHER}?ref=1`,
            'https://example.com/',
          ]),
        ),
      'https://api.firecrawl.dev/': async (request) => {
        const { url } = (await request.json()) as { url: string };
        return firecrawlResponse(url, listingHtml({ url, rows: FULL_ROWS }));
      },
      'https://model.test/': async (request) =>
        chat
          ? chat(await request.json())
          : chatResponse({ dishes: ['穴子寿司'], bookingNote: '1ヶ月前の1日から予約受付' }),
    }),
  };
}

test('discover reads each distinct main listing found by search', async () => {
  const candidates = await discover('鮨 テスト', '中目黒', sources());
  assert.deepEqual(
    candidates.map((candidate) => [candidate.ref, candidate.name, candidate.score]),
    [
      [LISTING_URL, '鮨 テスト (Sushi Test)', 3.62],
      [OTHER, '鮨 テスト (Sushi Test)', 3.62],
    ],
  );
});

test('a pasted listing URL skips search', async () => {
  const candidates = await discover(`${LISTING_URL}?tab=top`, undefined, sources());
  assert.deepEqual(
    candidates.map((candidate) => candidate.ref),
    [LISTING_URL],
  );
});

test('preview builds a draft from the listing; the model may only quote it', async () => {
  const { draft, duplicates, notes } = await preview(
    { source: 'tabelog', ref: LISTING_URL },
    [],
    sources(),
  );
  assert.equal(draft.title, '鮨 テスト');
  assert.equal(draft.alternateTitle, 'Sushi Test');
  assert.deepEqual([draft.latitude, draft.longitude], [35.6441, 139.6988]);
  assert.deepEqual(draft.tabelog, { url: LISTING_URL, score: 3.62 });
  assert.deepEqual(draft.reservation, {
    policy: 'required',
    label: '完全予約制 1ヶ月前の1日から予約受付 予約はこちら',
    bookingUrl: 'https://yoyaku.toreta.in/sushi-test/',
    note: '1ヶ月前の1日から予約受付',
  });
  assert.equal(draft.officialUrl, 'https://sushi-test.example/');
  assert.deepEqual(draft.dishes, ['穴子寿司']);
  assert.equal(draft.description, '主营寿司、海鲜。位于目黒区中目黒。招牌菜包括穴子寿司。');
  assert.equal(draft.regularClosingDays, '日・月');
  assert.deepEqual(duplicates, []);
  assert.deepEqual(notes, []);
});

test('invented dishes and booking notes are dropped; a model outage still yields a draft', async () => {
  const invented = await preview(
    { source: 'tabelog', ref: LISTING_URL },
    [],
    sources(() => chatResponse({ dishes: ['大トロ', 'ちらし寿司'], bookingNote: '3ヶ月前から' })),
  );
  assert.deepEqual(invented.draft.dishes, ['ちらし寿司']);
  assert.equal(invented.draft.reservation.note, undefined);

  const outage = await preview(
    { source: 'tabelog', ref: LISTING_URL },
    [],
    sources(() => new Response('', { status: 503 })),
  );
  assert.deepEqual(outage.draft.dishes, []);
  assert.equal(outage.draft.tabelog?.score, 3.62);
  assert.match(outage.notes.join(' '), /model was unavailable/u);
});

test('the same listing is reported as already saved', async () => {
  const saved = {
    id: 'saved-1',
    title: '鮨 テスト',
    tabelog: { url: LISTING_URL },
    latitude: 0,
    longitude: 0,
  } as Restaurant;
  const { duplicates } = await preview({ source: 'tabelog', ref: LISTING_URL }, [saved], sources());
  assert.deepEqual(duplicates, [{ id: 'saved-1', title: '鮨 テスト', match: 'same' }]);
});

test('reservation policy follows the listing wording', () => {
  assert.equal(reservationFromListing('予約可').policy, 'reservable');
  assert.equal(reservationFromListing('予約不可 ※当日のみ').policy, 'not_reservable');
  assert.equal(reservationFromListing('完全予約制').policy, 'required');
  assert.equal(reservationFromListing(undefined).policy, 'unknown');
});

test('saving requires a name, address and a location in Japan', () => {
  const valid = {
    id: 'draft-0001',
    title: '鮨 テスト',
    address: '東京都目黒区中目黒1-1-1',
    latitude: 35.6,
    longitude: 139.7,
    tabelog: { url: `${LISTING_URL}?x=1`, score: 3.6 },
    reservation: { policy: 'unknown', label: '' },
  };
  assert.equal(parseDraft(valid).tabelog?.url, LISTING_URL);
  for (const invalid of [
    { ...valid, title: '' },
    { ...valid, latitude: 48.8 },
    { ...valid, latitude: null },
    { ...valid, tabelog: { url: 'https://tabelog.com/rstLst/' } },
    { ...valid, reservation: { policy: 'maybe' } },
    { ...valid, officialUrl: 'javascript:alert(1)' },
  ]) {
    assert.throws(() => parseDraft(invalid), HttpError, JSON.stringify(invalid));
  }
});
