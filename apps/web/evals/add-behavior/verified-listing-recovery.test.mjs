import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createPlaceResearchAgent } from '../../agent/place-research.ts';

const dataset = JSON.parse(
  readFileSync(
    new URL('./verified-listing-recovery.v1.json', import.meta.url),
    'utf8',
  ),
);
const listingUrl = 'https://tabelog.com/tokyo/A1304/A130401/13210432/';

for (const sample of dataset.cases) {
  test(`verified listing recovery: ${sample.id}`, async () => {
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
                title: 'シェイクシャック 新宿サザンテラス',
                content: 'Branch-matched structured restaurant evidence',
                restaurant: {
                  name: 'シェイクシャック 新宿サザンテラス',
                  aliases: ['Shake Shack'],
                  address:
                    sample.source === 'wrong_building'
                      ? '東京都渋谷区代々木2-2-1 別館'
                      : '東京都渋谷区代々木2-2-1 新宿サザンテラス 小田急サザンタワー 2F',
                  postalCode: '1510053',
                  area: '渋谷区代々木',
                  coordinates: { latitude: 35.686597, longitude: 139.700879 },
                  categories: ['ハンバーガー'],
                  score: 3.4,
                  reservation: '予約不可',
                },
              },
            },
      fetch: async (url) => {
        if (url.startsWith('https://search.yahoo.co.jp/search'))
          return new Response(
            `<div id="web"><li><a href="${listingUrl}">シェイクシャック 新宿サザンテラス</a><div>東京都渋谷区代々木2-2-1</div></li></div>`,
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
        ownerQuery: sample.provider
          ? 'shake shack shinjuku'
          : 'シェイクシャック 新宿サザンテラス',
        providerNamespace: sample.provider ?? 'tabelog',
        placeId: sample.provider ? 'ChIJzwyHGdCMGGARjWDiZRmFzeI' : listingUrl,
        transientName: sample.provider
          ? 'SHAKE SHACK Shinjuku Southern Terrace'
          : 'シェイクシャック 新宿サザンテラス',
        transientAddress: sample.provider
          ? 'Japan, 〒151-8583 Tokyo, Shibuya, Yoyogi, 2-chōme−2−１ 新宿サザンテラス内 小田急サザンタワー２階'
          : '東京都渋谷区代々木2-2-1',
      },
    });
    assert.equal(result.kind, sample.expect);
    if (result.kind === 'observed') {
      assert.equal(result.value.tabelog.score, 3.4);
      assert.deepEqual(result.value.profile?.coordinates?.value, {
        latitude: 35.686597,
        longitude: 139.700879,
      });
      assert.equal(result.value.reservation.mode, 'not_reservable');
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
