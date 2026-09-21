import assert from 'node:assert/strict';
import test from 'node:test';

import { presentNearbyWechatReceipt } from './nearby-result-presenter.ts';

test('Nearby receipt keeps entry, reservation, personal, external, visit, route, provenance, warnings, and map facts separate', () => {
  const receipt = presentNearbyWechatReceipt({
    resolvedLocation: '東京都中央区銀座',
    recommendations: [
      {
        itemId: 'candidate-not-visited',
        name: '候補一号',
        kind: 'food',
        area: '銀座',
        address: '東京都中央区銀座1-1',
        straightLineDistanceKm: 0.7,
        route: {
          mode: 'walking',
          durationMinutes: 9,
          checkedAt: '2026-09-13T12:00:00.000Z',
          source: { label: 'Google Maps', url: 'https://maps.example/route-1' },
        },
        visit: {
          manualVisited: false,
          visitCount: 0,
          personalRating: 4.8,
        },
        entryAccess: {
          walkInAssertion: {
            status: 'confirmed',
            sourceUrl: 'https://entry.example/walk-in',
            checkedAt: '2026-09-13T12:01:00.000Z',
          },
          queueAssertion: {
            status: 'waiting_reported',
            sourceUrl: 'https://entry.example/queue',
            checkedAt: '2026-09-13T12:02:00.000Z',
          },
        },
        reservation: {
          label: '可预约',
          checkedAt: '2026-09-13T11:00:00.000Z',
        },
        externalRating: {
          platform: '食べログ',
          score: 3.7,
          sourceUrl: 'https://rating.example/place',
          checkedAt: '2026-09-13T11:30:00.000Z',
          reviewCount: 42,
        },
        reason: '步行范围内的未到访餐厅',
        warnings: ['排队时长未提供'],
        mapDeepLink: 'https://maps.example/place-1',
      },
      {
        itemId: 'visited-place',
        name: '候補二号',
        kind: 'food',
        area: '築地',
        address: '東京都中央区築地2-2',
        straightLineDistanceKm: 1.2,
        visit: {
          manualVisited: false,
          visitCount: 2,
          latestVisitAt: '2026-09-01',
          personalRating: 4.2,
        },
        entryAccess: {
          walkInAssertion: {
            status: 'reservation_required',
            sourceUrl: 'https://entry.example/reservation',
            checkedAt: '2026-09-13T12:03:00.000Z',
          },
          queueAssertion: {
            status: 'none_reported',
            sourceUrl: 'https://entry.example/no-queue',
            checkedAt: '2026-09-13T12:04:00.000Z',
          },
        },
        reservation: {
          label: '予約必須の可能性あり',
          checkedAt: '2026-09-13T11:10:00.000Z',
        },
        reason: '以前行った場所',
        warnings: ['路线证据不可用；仅显示直线距离'],
        mapDeepLink: 'https://maps.example/place-2',
      },
    ],
  });

  assert.match(receipt, /Japan Atlas｜附近推荐：東京都中央区銀座/u);
  assert.match(receipt, /1\. 候補一号（food · 銀座）/u);
  assert.match(receipt, /地址：東京都中央区銀座1-1/u);
  assert.match(receipt, /直线距离：0\.7 km/u);
  assert.match(receipt, /路线：步行 9 分钟/u);
  assert.match(receipt, /到访：未到访 · 0 次/u);
  assert.match(receipt, /个人评分：仅在到访后显示/u);
  assert.doesNotMatch(receipt, /个人评分：4\.8/u);
  assert.match(receipt, /外部评分（食べログ）：3\.7\/5 · 42 条评论/u);
  assert.match(receipt, /到店：可直接到店/u);
  assert.match(receipt, /排队：已报告排队（时长未知）/u);
  assert.match(receipt, /预约：可预约/u);
  assert.match(receipt, /来源：https:\/\/entry\.example\/walk-in/u);
  assert.match(receipt, /警告：排队时长未提供/u);
  assert.match(receipt, /地图：https:\/\/maps\.example\/place-1/u);
  assert.match(receipt, /2\. 候補二号（food · 築地）/u);
  assert.match(receipt, /到访：已到访 · 2 次 · 最近：2026-09-01/u);
  assert.match(receipt, /个人评分：4\.2\/5/u);
  assert.match(receipt, /到店：需要预约/u);
  assert.match(receipt, /排队：来源报告当前无需排队/u);
  assert.match(receipt, /路线：未知/u);
});
