import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createPlaceResearchAgent } from '../../apps/web/agent/place-research.ts';
import {
  canonicalTableCheckBookingUrl,
  isTableCheckBookingPage,
  parseTableCheckBookingPage,
} from '../../apps/web/agent/tablecheck-booking.ts';

const capture = JSON.parse(
  readFileSync(new URL('./tablecheck-modern.v1.json', import.meta.url), 'utf8'),
);

function merchantHtml(name, officialHost, officialLabel = '公式サイト') {
  return `<title>${name} - TableCheck (テーブルチェック)</title>
    <h3 class="panel-title">${name}を予約する</h3>
    <div class="reserveform-bookingpolicy-text">
      ★こちらはレストランのご予約ページです。<br>
      <a href="https://${officialHost}/rest/private/">${officialLabel}</a><br>
      ◆ご予約◆<br>${capture.bookingWindowLabel}。<br>
      【ご予約受付開始時間】<br>公式HP：${capture.releaseNote} お電話：毎月1日の午前10時00分より<br>
    </div>`;
}

test('modern TableCheck page keeps the exact merchant policy and host', () => {
  assert.equal(capture.captureClass, 'independently_verified_web_capture');
  assert.ok(isTableCheckBookingPage(capture.bookingUrl));
  assert.ok(isTableCheckBookingPage(capture.pickupUrl));
  assert.ok(
    !isTableCheckBookingPage('https://other.example/shops/shop/reserve'),
  );
  assert.ok(
    !isTableCheckBookingPage(`${capture.bookingUrl}?service_category_id=other`),
  );
  assert.equal(
    canonicalTableCheckBookingUrl(
      `${capture.bookingUrl}?service_category_id=other`,
    ),
    capture.bookingUrl,
  );
  const page = parseTableCheckBookingPage(
    merchantHtml(capture.name, 'ogasawaratei.com'),
    capture.bookingUrl,
  );
  assert.equal(page?.booking.name, capture.name);
  assert.equal(page?.booking.officialWebsiteHost, 'ogasawaratei.com');
  assert.equal(page?.booking.bookingWindowLabel, capture.bookingWindowLabel);
  assert.equal(page?.booking.releaseNote, capture.releaseNote);
  assert.equal(page?.booking.address, undefined);
  assert.equal(
    parseTableCheckBookingPage(
      merchantHtml(capture.name, 'ogasawaratei.com').replace(
        `${capture.name}を予約する`,
        'Oga Barを予約する',
      ),
      capture.bookingUrl,
    ),
    undefined,
  );
});

test('modern TableCheck does not treat an unrelated directory link as official-site proof', () => {
  assert.equal(
    parseTableCheckBookingPage(
      merchantHtml(capture.name, 'ogasawaratei.com', '個室のご案内'),
      capture.bookingUrl,
    ),
    undefined,
  );
});

for (const scenario of [
  {
    id: 'exact-branch',
    bookingName: capture.name,
    officialHost: 'ogasawaratei.com',
    expected: true,
  },
  ...capture.negativeCases.map((entry) => ({ ...entry, expected: false })),
]) {
  test(`modern TableCheck research: ${scenario.id}`, async () => {
    let searches = 0;
    const agent = createPlaceResearchAgent({
      apiKey: 'fixture',
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      searchApiKey: 'fixture',
      sourceReader: async () => ({
        kind: 'read',
        evidence: {
          url: capture.listingUrl,
          title: capture.name,
          content: `${capture.name} ${capture.address}`,
          restaurant: {
            name: capture.name,
            address: capture.address,
            postalCode: capture.postalCode,
            area: '新宿区',
            score: 3.69,
            categories: ['スペイン料理'],
            reservation: '完全予約制',
            officialWebsite: capture.officialWebsite,
          },
        },
      }),
      fetch: async (url) => {
        if (url === 'https://api.tavily.com/search') {
          searches++;
          return Response.json({
            results:
              searches === 1
                ? [
                    {
                      url: capture.listingUrl,
                      title: capture.name,
                      content: `${capture.name} ${capture.address}`,
                    },
                  ]
                : [
                    {
                      url: capture.pickupUrl,
                      title: '小笠原伯爵邸（テイクアウト・デリバリー）',
                      content: 'Pickup only',
                    },
                    {
                      url: `${capture.bookingUrl}?service_category_id=other`,
                      title: scenario.bookingName,
                      content: capture.bookingWindowLabel,
                    },
                  ],
          });
        }
        if (url === capture.pickupUrl)
          return new Response(
            merchantHtml(
              '小笠原伯爵邸（テイクアウト・デリバリー）',
              'ogasawaratei.com',
            ),
            { headers: { 'content-type': 'text/html' } },
          );
        if (url === capture.bookingUrl)
          return new Response(
            merchantHtml(scenario.bookingName, scenario.officialHost),
            {
              headers: { 'content-type': 'text/html' },
            },
          );
        assert.equal(url, 'https://model.example/v1/chat/completions');
        return Response.json({
          choices: [{ message: { content: 'invalid model JSON' } }],
        });
      },
    });
    const result = await agent.research({
      selectedSubject: {
        ownerQuery: '小笠原伯爵邸 若松河田',
        providerNamespace: 'google-places',
        placeId: 'fixture-google-id',
        transientName: 'Ogasawara Hakushaku-tei',
        transientAddress:
          scenario.selectedAddress ??
          '10-10 Kawadachō, Shinjuku City, Tokyo 162-0054, Japan',
      },
    });
    assert.equal(searches, scenario.id === 'wrong-selected-street' ? 1 : 2);
    assert.equal(
      result.kind,
      scenario.id === 'wrong-selected-street' ? 'unavailable' : 'observed',
    );
    if (result.kind === 'observed') {
      assert.equal(result.value.tabelog.score, 3.69);
      assert.equal(
        result.value.reservation.releaseNote,
        scenario.expected ? capture.releaseNote : undefined,
      );
    }
  });
}
