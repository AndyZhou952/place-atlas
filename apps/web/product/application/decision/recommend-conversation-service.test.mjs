import assert from 'node:assert/strict';
import test from 'node:test';

import { createRecommendConversationService } from './recommend-conversation-service.ts';

const now = '2026-09-30T00:00:00.000Z';

function item(id, title, area, tags, latitude = 35.67) {
  return {
    id,
    kind: 'food',
    verificationStatus: 'verified',
    title,
    area,
    address: `${title} address`,
    description: '',
    latitude,
    longitude: 139.76,
    verifiedAt: now,
    reservation: { mode: 'unknown', label: 'Unknown' },
    personalState: 'candidate',
    tags,
    sources: [],
    hasVisited: false,
  };
}

function service(items, interpreter, routeProvider = {}) {
  return createRecommendConversationService({
    catalog: {
      async list() {
        return items;
      },
    },
    interpreter,
    locationResolver: {
      async resolve(locationHint) {
        assert.equal(locationHint, '新宿駅');
        return {
          status: 'resolved',
          location: {
            canonicalAddress: '新宿駅',
            point: { latitude: 35.69, longitude: 139.7 },
          },
          attribution: { label: 'Google Maps', url: 'https://google.com/maps' },
        };
      },
    },
    routeProvider: {
      async walking() {
        throw new Error('batch route expected');
      },
      ...routeProvider,
    },
    clock: { now: () => new Date(now) },
  });
}

test('area recommendation needs no route provider and opens the exact saved detail', async () => {
  const recommend = service(
    [
      item('saved-sushi', '寿司 青空', '銀座・東京', ['寿司']),
      item('other', '麺 空', '新宿・東京', ['ラーメン']),
    ],
    {
      async interpret(_input, options) {
        assert.ok(options.some((option) => option.id === 'area:銀座'));
        return {
          action: 'recommend',
          originId: 'area:銀座',
          foodTerms: ['寿司'],
          excludedFoodTerms: [],
          travelMode: 'none',
          maxMinutes: null,
          visited: 'any',
        };
      },
    },
  );
  const result = await recommend.ask({ query: '銀座の寿司', replies: [] });
  assert.equal(result.status, 'recommend');
  assert.equal(result.recommendations[0].itemId, 'saved-sushi');
  assert.equal(result.recommendations[0].detailTargetId, 'saved-sushi');
  assert.equal(result.recommendations[0].routeClaim, undefined);
});

test('timed broad-area request asks for exact origin before any route call', async () => {
  const recommend = service(
    [item('saved-sushi', '寿司 青空', '銀座・東京', ['寿司'])],
    {
      async interpret() {
        return {
          action: 'recommend',
          originId: 'area:銀座',
          foodTerms: ['寿司'],
          excludedFoodTerms: [],
          travelMode: 'walk',
          maxMinutes: 10,
          visited: 'any',
        };
      },
    },
  );
  const result = await recommend.ask({
    query: '銀座から徒歩10分の寿司',
    replies: [],
  });
  assert.equal(result.status, 'clarify');
  assert.equal(result.clarification, 'exact_origin');
});

test('reply keeps cuisine and time constraints through geocoding and one batched route call', async () => {
  let batches = 0;
  const recommend = service(
    [
      item('saved-ramen', '麺 空', '新宿・東京', ['ラーメン']),
      item('saved-sushi', '寿司 青空', '新宿・東京', ['寿司'], 35.68),
    ],
    {
      async interpret(input) {
        assert.equal(input.query, '徒歩10分のラーメン');
        assert.deepEqual(input.replies, ['新宿駅']);
        return {
          action: 'recommend',
          originText: '新宿駅',
          originKind: 'station',
          foodTerms: ['ramen'],
          excludedFoodTerms: [],
          travelMode: 'walk',
          maxMinutes: 10,
          visited: 'any',
        };
      },
    },
    {
      async walkingMany(_origin, destinations) {
        batches += 1;
        assert.equal(destinations.length, 2);
        return destinations.map((_, index) => ({
          status: 'fresh',
          durationSeconds: index === 0 ? 600 : 300,
          distanceMeters: 800,
          checkedAt: now,
          attribution: { label: 'Google Maps', url: 'https://google.com/maps' },
        }));
      },
    },
  );
  const result = await recommend.ask({
    query: '徒歩10分のラーメン',
    replies: ['新宿駅'],
  });
  assert.equal(result.status, 'recommend');
  assert.equal(batches, 1);
  assert.deepEqual(
    result.recommendations.map((candidate) => candidate.itemId),
    ['saved-ramen'],
  );
  assert.deepEqual(result.recommendations[0].routeClaim, {
    mode: 'walk',
    seconds: 600,
  });
  assert.deepEqual(result.recommendations[0].route, {
    mode: 'walk',
    seconds: 600,
    checkedAt: now,
    source: { label: 'Google Maps', url: 'https://google.com/maps' },
  });
});

test('interpreter failure stays unavailable and does not suggest unsaved restaurants', async () => {
  const recommend = service(
    [item('saved-sushi', '寿司 青空', '銀座', ['寿司'])],
    {
      async interpret() {
        throw new Error('provider down');
      },
    },
  );
  assert.deepEqual(await recommend.ask({ query: '銀座の寿司', replies: [] }), {
    status: 'unavailable',
    message: 'Recommendations are temporarily unavailable. Please retry.',
    retryable: true,
  });
});

test('model-supplied restaurant names are ignored; the receipt uses saved database identity', async () => {
  const recommend = service(
    [item('saved-sushi', '寿司 青空', '銀座', ['寿司'])],
    {
      async interpret() {
        return {
          action: 'recommend',
          originId: 'area:銀座',
          foodTerms: ['sushi'],
          excludedFoodTerms: [],
          travelMode: 'none',
          maxMinutes: null,
          visited: 'any',
          recommendations: [
            { name: 'Invented restaurant', itemId: 'unknown-item' },
          ],
        };
      },
    },
  );
  const result = await recommend.ask({ query: '銀座の寿司', replies: [] });
  assert.equal(result.status, 'recommend');
  assert.equal(result.recommendations[0].name, '寿司 青空');
  assert.equal(result.recommendations[0].itemId, 'saved-sushi');
});

test('a saved item removed before delivery cannot appear in the response', async () => {
  let reads = 0;
  const recommend = createRecommendConversationService({
    catalog: {
      async list() {
        reads += 1;
        return reads === 1
          ? [item('saved-sushi', '寿司 青空', '銀座', ['寿司'])]
          : [];
      },
    },
    interpreter: {
      async interpret() {
        return {
          action: 'recommend',
          originId: 'area:銀座',
          foodTerms: ['sushi'],
          excludedFoodTerms: [],
          travelMode: 'none',
          maxMinutes: null,
          visited: 'any',
        };
      },
    },
    locationResolver: {
      async resolve() {
        throw new Error('unexpected');
      },
    },
    routeProvider: {
      async walking() {
        throw new Error('unexpected');
      },
    },
    clock: { now: () => new Date(now) },
  });
  assert.deepEqual(await recommend.ask({ query: '銀座の寿司', replies: [] }), {
    status: 'unavailable',
    message: 'Recommendations are temporarily unavailable. Please retry.',
    retryable: true,
  });
  assert.equal(reads, 2);
});

test('a saved shop name is an origin hint and recommends another nearby saved place', async () => {
  const recommend = service(
    [
      item('origin-shop', '喫茶 みずき 新宿店', '新宿', ['喫茶店']),
      item('nearby-shop', '麺 空', '新宿', ['ラーメン'], 35.671),
      item('far-shop', '寿司 青空', '銀座', ['寿司'], 35.8),
    ],
    {
      async interpret() {
        return {
          action: 'recommend',
          originId: 'place:origin-shop',
          foodTerms: [],
          excludedFoodTerms: [],
          travelMode: 'none',
          maxMinutes: null,
          visited: 'prefer_unvisited',
        };
      },
    },
  );
  const result = await recommend.ask({
    query: '喫茶 みずき 新宿店',
    replies: [],
  });
  assert.equal(result.status, 'recommend');
  assert.deepEqual(
    result.recommendations.map(({ itemId }) => itemId),
    ['nearby-shop'],
  );
  assert.match(result.recommendations[0].reason, /straight-line distance/u);
  assert.equal(result.recommendations[0].routeClaim, undefined);
  assert.deepEqual(result.warnings, ['unverified_travel_time']);
});
