import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createPlaceResearchAgent } from '../../apps/web/agent/place-research.ts';

const dataset = JSON.parse(
  readFileSync(
    new URL('./verified-listing-recovery.v1.json', import.meta.url),
    'utf8',
  ),
);
for (const sample of dataset.cases) {
  test(`verified listing recovery: ${sample.id}`, async () => {
    const tsukimori = sample.restaurant === 'tsukimori';
    const ogasawara = sample.restaurant === 'ogasawara';
    const listingUrl = ogasawara
      ? 'https://tabelog.com/tokyo/A1305/A130504/13000998/'
      : tsukimori
        ? 'https://tabelog.com/osaka/A2701/A270204/27121949/'
        : 'https://tabelog.com/tokyo/A1304/A130401/13210432/';
    const listingName = ogasawara
      ? '小笠原伯爵邸'
      : tsukimori
        ? '喫茶 月森'
        : 'シェイクシャック 新宿サザンテラス';
    const listingAddress = ogasawara
      ? '東京都新宿区河田町10-10'
      : tsukimori
        ? '大阪府大阪市中央区瓦屋町1-6-10'
        : '東京都渋谷区代々木2-2-1 新宿サザンテラス 小田急サザンタワー 2F';
    const diagnostics = [];
    const agent = createPlaceResearchAgent({
      apiKey: 'fixture',
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      onDiagnostic: (code) => diagnostics.push(code),
      sourceReader: async () =>
        sample.source === 'blocked'
          ? { kind: 'blocked' }
          : {
              kind: 'read',
              evidence: {
                url:
                  sample.source === 'wrong_url'
                    ? 'https://tabelog.com/tokyo/A1304/A130401/13210433/'
                    : listingUrl,
                title: listingName,
                content: 'Branch-matched structured restaurant evidence',
                restaurant: {
                  name: listingName,
                  aliases: ogasawara
                    ? ['オガサワラハクシャクテイ']
                    : tsukimori
                      ? []
                      : ['Shake Shack'],
                  address:
                    sample.source === 'wrong_street'
                      ? ogasawara
                        ? '東京都新宿区河田町10-11'
                        : '大阪府大阪市中央区瓦屋町1-6-11'
                      : sample.source === 'wrong_building'
                        ? '東京都渋谷区代々木2-2-1 別館'
                        : listingAddress,
                  postalCode: ogasawara
                    ? '1620054'
                    : tsukimori
                      ? '5420066'
                      : '1510053',
                  area: ogasawara
                    ? '新宿区河田町'
                    : tsukimori
                      ? '大阪市中央区瓦屋町'
                      : '渋谷区代々木',
                  coordinates: ogasawara
                    ? { latitude: 35.698341, longitude: 139.71752 }
                    : tsukimori
                      ? { latitude: 34.673283, longitude: 135.512951 }
                      : { latitude: 35.686597, longitude: 139.700879 },
                  categories: ogasawara
                    ? ['スペイン料理']
                    : tsukimori
                      ? ['喫茶店']
                      : ['ハンバーガー'],
                  score: ogasawara ? 3.69 : tsukimori ? 3.19 : 3.4,
                  reservation: ogasawara
                    ? '完全予約制'
                    : tsukimori
                      ? '予約可'
                      : '予約不可',
                },
              },
            },
      fetch: async (url) => {
        if (url.startsWith('https://search.yahoo.co.jp/search'))
          return new Response(
            `<div id="web"><li><a href="${listingUrl}">${listingName}</a><div>${listingAddress}</div></li></div>`,
            { headers: { 'content-type': 'text/html' } },
          );
        assert.equal(url, 'https://model.example/v1/chat/completions');
        return sample.model === 'http_error'
          ? new Response('{}', {
              status: 503,
              headers: { 'content-type': 'application/json' },
            })
          : Response.json({
              choices: [
                {
                  message: {
                    content:
                      sample.model === 'empty_valid'
                        ? JSON.stringify({
                            subjectMatch: 'matched',
                            tabelog: { status: 'unknown' },
                            reservation: { status: 'unknown' },
                          })
                        : '{invalid json',
                  },
                },
              ],
            });
      },
    });
    const result = await agent.research({
      selectedSubject: {
        ownerQuery: ogasawara
          ? '小笠原伯爵邸 若松河田'
          : tsukimori
            ? '喫茶 月森 大阪 松屋町'
            : sample.provider
              ? 'shake shack shinjuku'
              : 'シェイクシャック 新宿サザンテラス',
        providerNamespace: sample.provider ?? 'tabelog',
        placeId: sample.provider
          ? ogasawara
            ? 'ChIJogasawaraFixture'
            : tsukimori
              ? 'ChIJtsukimoriFixture'
              : 'ChIJzwyHGdCMGGARjWDiZRmFzeI'
          : listingUrl,
        transientName: ogasawara
          ? 'Ogasawara Hakushaku-tei'
          : tsukimori
            ? 'Cafe Tsukimori'
            : sample.provider
              ? 'SHAKE SHACK Shinjuku Southern Terrace'
              : 'シェイクシャック 新宿サザンテラス',
        transientAddress: ogasawara
          ? '10-10 Kawadachō, Shinjuku City, Tokyo 162-0054, Japan'
          : tsukimori
            ? '1-chōme-6-10 Kawarayamachi, Chuo Ward, Osaka, 542-0066, Japan'
            : sample.provider
              ? 'Japan, 〒151-8583 Tokyo, Shibuya, Yoyogi, 2-chōme−2−１ 新宿サザンテラス内 小田急サザンタワー２階'
              : '東京都渋谷区代々木2-2-1',
      },
    });
    assert.equal(result.kind, sample.expect);
    if (result.kind === 'observed') {
      assert.equal(
        result.value.tabelog.score,
        ogasawara ? 3.69 : tsukimori ? 3.19 : 3.4,
      );
      assert.deepEqual(
        result.value.profile?.coordinates?.value,
        ogasawara
          ? { latitude: 35.698341, longitude: 139.71752 }
          : tsukimori
            ? { latitude: 34.673283, longitude: 135.512951 }
            : { latitude: 35.686597, longitude: 139.700879 },
      );
      assert.equal(
        result.value.reservation.mode,
        ogasawara
          ? 'reservation_required'
          : tsukimori
            ? 'reservable'
            : 'not_reservable',
      );
      if (sample.model === 'empty_valid') {
        assert.ok(diagnostics.includes('profile_accept_coordinates'));
      } else {
        assert.ok(diagnostics.includes('verified_listing_fallback'));
      }
    } else {
      assert.ok(!diagnostics.includes('verified_listing_fallback'));
    }
  });
}
