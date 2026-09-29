import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaceResearchAgent } from '../../agent/place-research.ts';

const listingUrl = 'https://tabelog.com/tokyo/A1304/A130401/13118210/';
const selectedSubject = {
  ownerQuery: '牛タン 荒 新宿',
  providerNamespace: 'google-places',
  placeId: 'ChIJGyutanAraFixture',
  transientName: 'Gyutan Ara',
  transientAddress:
    'Japan, 〒160-0023 Tokyo, Shinjuku City, Nishishinjuku, 1-chōme−16−４ 地下二階',
};

for (const sample of [
  {
    id: 'kana-variant-short-owner-name-matches-exact-branch',
    name: '牛たん 荒 新宿西口店',
    address: '東京都新宿区西新宿1-16-4 井門西新宿ビル B2F',
    expect: 'observed',
  },
  {
    id: 'similar-name-in-same-building-does-not-inherit-facts',
    name: '牛たん 嵐 新宿西口店',
    address: '東京都新宿区西新宿1-16-4 井門西新宿ビル B2F',
    expect: 'unavailable',
  },
  {
    id: 'same-name-on-different-street-does-not-inherit-facts',
    name: '牛たん 荒 新宿西口店',
    address: '東京都新宿区西新宿1-16-5 井門西新宿ビル B2F',
    expect: 'unavailable',
  },
]) {
  test(`Add branch recovery: ${sample.id}`, async () => {
    const agent = createPlaceResearchAgent({
      apiKey: 'fixture',
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      sourceReader: async () => ({
        kind: 'read',
        evidence: {
          url: listingUrl,
          title: sample.name,
          content: `${sample.name} ${sample.address}`,
          restaurant: {
            name: sample.name,
            address: sample.address,
            postalCode: '1600023',
            area: '新宿区西新宿',
            coordinates: { latitude: 35.6895, longitude: 139.6972 },
            categories: ['牛タン', '居酒屋'],
            score: 3.5,
            reservation: '予約可',
          },
        },
      }),
      fetch: async (url) => {
        if (url.startsWith('https://search.yahoo.co.jp/search'))
          return new Response(
            `<div id="web"><li><a href="${listingUrl}">${sample.name}</a><div>${sample.address}</div></li></div>`,
            { headers: { 'content-type': 'text/html' } },
          );
        assert.equal(url, 'https://model.example/v1/chat/completions');
        return Response.json({}, { status: 503 });
      },
    });
    const result = await agent.research({ selectedSubject });
    assert.equal(result.kind, sample.expect);
    if (result.kind === 'observed') {
      assert.equal(result.value.tabelog.score, 3.5);
      assert.equal(result.value.reservation.mode, 'reservable');
      assert.deepEqual(result.value.profile.coordinates.value, {
        latitude: 35.6895,
        longitude: 139.6972,
      });
    }
  });
}
