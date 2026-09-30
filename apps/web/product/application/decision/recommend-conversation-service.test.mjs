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

function service(
  items,
  interpreter,
  routeProvider = {},
  clock = { now: () => new Date(now) },
  expectedOrigin = '新宿駅',
  transitRouteProvider,
) {
  return createRecommendConversationService({
    catalog: {
      async list() {
        return items;
      },
    },
    interpreter,
    locationResolver: {
      async resolve(locationHint) {
        assert.equal(locationHint, expectedOrigin);
        return {
          status: 'resolved',
          location: {
            canonicalAddress: expectedOrigin,
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
    transitRouteProvider,
    clock,
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
  assert.match(result.recommendations[0].reason, /in 銀座/u);
  assert.doesNotMatch(result.recommendations[0].reason, /area:/u);
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
        assert.equal(destinations.length, 1);
        return destinations.map(() => ({
          status: 'fresh',
          durationSeconds: 600,
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

test('a station reply overrides an earlier broad area even when the model repeats the area', async () => {
  const recommend = service(
    [item('saved-ramen', '麺 空', '新宿・東京', ['ラーメン'])],
    {
      async interpret() {
        return {
          action: 'clarify',
          originId: 'area:新宿',
          foodTerms: ['ramen'],
          excludedFoodTerms: [],
          travelMode: 'walk',
          maxMinutes: 10,
          visited: 'any',
          clarification: 'exact_origin',
        };
      },
    },
    {
      async walkingMany() {
        return [
          {
            status: 'fresh',
            durationSeconds: 600,
            distanceMeters: 800,
            checkedAt: now,
            attribution: {
              label: 'Google Maps',
              url: 'https://google.com/maps',
            },
          },
        ];
      },
    },
  );
  const result = await recommend.ask({
    query: '新宿で徒歩10分のラーメン',
    replies: ['新宿駅'],
  });
  assert.equal(result.status, 'recommend');
  assert.equal(result.recommendations[0].itemId, 'saved-ramen');
});

test('a station in the first request is an exact origin even when the model repeats an area', async () => {
  const recommend = service(
    [item('saved-ramen', '麺 空', '新宿・東京', ['ラーメン'])],
    {
      async interpret() {
        return {
          action: 'recommend',
          originId: 'area:新宿',
          foodTerms: ['ramen'],
          excludedFoodTerms: [],
          travelMode: 'walk',
          maxMinutes: 15,
          visited: 'any',
        };
      },
    },
    {
      async walkingMany() {
        return [
          {
            status: 'fresh',
            durationSeconds: 600,
            distanceMeters: 800,
            checkedAt: now,
            attribution: {
              label: 'Google Maps',
              url: 'https://google.com/maps',
            },
          },
        ];
      },
    },
  );
  const result = await recommend.ask({
    query: '新宿駅から徒歩15分のラーメン',
    replies: [],
  });
  assert.equal(result.status, 'recommend');
  assert.equal(result.recommendations[0].itemId, 'saved-ramen');
});

test('an English station in the production-style catalog overrides a model area', async () => {
  const recommend = service(
    [item('saved-sushi', '寿司 青空', '銀座・東京', ['寿司'])],
    {
      async interpret(input, options) {
        assert.equal(
          options.some((option) => option.kind === 'station'),
          false,
        );
        return {
          action: 'recommend',
          originId: 'area:銀座',
          foodTerms: ['sushi'],
          excludedFoodTerms: [],
          travelMode:
            input.query === 'Sushi near Ginza Station' ? 'none' : 'transit',
          maxMinutes: input.query === 'Sushi near Ginza Station' ? null : 20,
          visited: 'any',
        };
      },
    },
    {},
    { now: () => new Date(now) },
    'Ginza Station',
    {
      async transit() {
        return {
          status: 'fresh',
          durationSeconds: 900,
          boardingCount: 1,
          transferCount: 0,
          checkedAt: now,
          attribution: { label: 'Google Maps', url: 'https://google.com/maps' },
        };
      },
    },
  );
  const result = await recommend.ask({
    query: 'Sushi within 20 minutes by direct train from Ginza Station',
    replies: [],
  });
  assert.equal(result.status, 'recommend');
  assert.equal(result.recommendations[0].itemId, 'saved-sushi');
  assert.equal(result.recommendations[0].name, '寿司 青空');
  const replyResult = await recommend.ask({
    query: '銀座から電車20分以内の寿司',
    replies: ['Ginza Station'],
  });
  assert.equal(replyResult.status, 'recommend');
  assert.equal(replyResult.recommendations[0].itemId, 'saved-sushi');
  const nearResult = await recommend.ask({
    query: 'Sushi near Ginza Station',
    replies: [],
  });
  assert.equal(nearResult.status, 'no_results');
});

test('a coffee request routes a saved cafe category without routing unrelated food', async () => {
  let transitCalls = 0;
  const recommend = service(
    [
      item('saved-cafe', 'Saved Coffee Roaster', '六本木・東京', ['カフェ']),
      item('saved-ramen', '麺 空', '銀座・東京', ['ラーメン']),
    ],
    {
      async interpret() {
        return {
          action: 'recommend',
          originId: 'area:銀座',
          foodTerms: ['coffee'],
          excludedFoodTerms: [],
          travelMode: 'transit',
          maxMinutes: 20,
          visited: 'any',
        };
      },
    },
    {},
    { now: () => new Date(now) },
    '銀座駅',
    {
      async transit() {
        transitCalls += 1;
        return {
          status: 'fresh',
          durationSeconds: 1080,
          boardingCount: 1,
          transferCount: 0,
          checkedAt: now,
          attribution: { label: 'Google Maps', url: 'https://google.com/maps' },
        };
      },
    },
  );
  const result = await recommend.ask({
    query: '銀座駅から電車20分以内のコーヒー',
    replies: [],
  });
  assert.equal(result.status, 'recommend');
  assert.equal(transitCalls, 1);
  assert.equal(result.recommendations[0].itemId, 'saved-cafe');
  assert.equal(result.recommendations[0].route.seconds, 1080);
});

test('unsupported Japan train coverage returns an honest answer without a paid route call', async () => {
  let transitCalls = 0;
  const recommend = service(
    [item('saved-cafe', 'Saved Coffee Roaster', '六本木・東京', ['カフェ'])],
    {
      async interpret() {
        return {
          action: 'recommend',
          originText: '銀座駅',
          originKind: 'station',
          foodTerms: ['coffee'],
          excludedFoodTerms: [],
          travelMode: 'transit',
          maxMinutes: 20,
          visited: 'any',
        };
      },
    },
    {},
    { now: () => new Date(now) },
    '銀座駅',
    {
      coverage() {
        return 'unsupported_region';
      },
      async transit() {
        transitCalls += 1;
        throw new Error('Unsupported train route must not be requested');
      },
    },
  );
  const result = await recommend.ask({
    query: '銀座駅から電車20分以内のコーヒー',
    replies: [],
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.retryable, false);
  assert.match(result.message, /Japan/u);
  assert.equal(transitCalls, 0);
});

test('walking provider failure remains unavailable instead of a false empty catalog', async () => {
  const recommend = service(
    [item('saved-ramen', '麺 空', '新宿・東京', ['ラーメン'])],
    {
      async interpret() {
        return {
          action: 'recommend',
          originText: '新宿駅',
          originKind: 'station',
          foodTerms: ['ramen'],
          excludedFoodTerms: [],
          travelMode: 'walk',
          maxMinutes: 15,
          visited: 'any',
        };
      },
    },
    {
      async walkingMany() {
        return [{ status: 'unavailable' }];
      },
    },
  );
  const result = await recommend.ask({
    query: '新宿駅から徒歩15分のラーメン',
    replies: [],
  });
  assert.equal(result.status, 'unavailable');
});

test('route timestamps created after the request began are still fresh', async () => {
  let clockReads = 0;
  const checkedAt = new Date(Date.parse(now) + 1_000).toISOString();
  const recommend = service(
    [item('saved-ramen', '麺 空', '新宿・東京', ['ラーメン'])],
    {
      async interpret() {
        return {
          action: 'recommend',
          originText: '新宿駅',
          originKind: 'station',
          foodTerms: ['ramen'],
          excludedFoodTerms: [],
          travelMode: 'walk',
          maxMinutes: 15,
          visited: 'any',
        };
      },
    },
    {
      async walkingMany() {
        clockReads = 1;
        return [
          {
            status: 'fresh',
            durationSeconds: 600,
            distanceMeters: 800,
            checkedAt,
            attribution: {
              label: 'Google Maps',
              url: 'https://google.com/maps',
            },
          },
        ];
      },
    },
    { now: () => new Date(Date.parse(now) + clockReads++ * 1_000) },
  );
  const result = await recommend.ask({
    query: '新宿駅から徒歩15分のラーメン',
    replies: [],
  });
  assert.equal(result.status, 'recommend');
  assert.equal(result.recommendations[0].route.checkedAt, checkedAt);
});

test('small service-clock skew is tolerated but future route evidence fails closed', async () => {
  for (const [offsetMs, expected] of [
    [30, 'recommend'],
    [10_000, 'unavailable'],
  ]) {
    const recommend = service(
      [item('saved-ramen', '麺 空', '新宿・東京', ['ラーメン'])],
      {
        async interpret() {
          return {
            action: 'recommend',
            originText: '新宿駅',
            originKind: 'station',
            foodTerms: ['ramen'],
            excludedFoodTerms: [],
            travelMode: 'walk',
            maxMinutes: 15,
            visited: 'any',
          };
        },
      },
      {
        async walkingMany() {
          return [
            {
              status: 'fresh',
              durationSeconds: 600,
              distanceMeters: 800,
              checkedAt: new Date(Date.parse(now) + offsetMs).toISOString(),
              attribution: {
                label: 'Google Maps',
                url: 'https://google.com/maps',
              },
            },
          ];
        },
      },
    );
    const result = await recommend.ask({
      query: '新宿駅から徒歩15分のラーメン',
      replies: [],
    });
    assert.equal(result.status, expected);
  }
});

test('transit routes only relevant saved candidates and returns the exact catalog name', async () => {
  const transitDestinations = [];
  const catalog = [
    item('near-sushi', '寿司 青空', '新宿', ['寿司'], 35.691),
    item('ramen', '麺 空', '新宿', ['ラーメン'], 35.7),
    item('distant-ramen', '麺 遠', '遠方', ['ラーメン'], 40),
  ];
  const recommend = createRecommendConversationService({
    catalog: {
      async list() {
        return catalog;
      },
    },
    interpreter: {
      async interpret() {
        return {
          action: 'recommend',
          originText: '新宿駅',
          originKind: 'station',
          foodTerms: ['ramen'],
          excludedFoodTerms: [],
          travelMode: 'transit',
          maxMinutes: 20,
          visited: 'prefer_unvisited',
          recommendations: [{ name: 'Ramen Invented' }],
        };
      },
    },
    locationResolver: {
      async resolve() {
        return {
          status: 'resolved',
          location: {
            canonicalAddress: '新宿駅',
            point: { latitude: 35.69, longitude: 139.7 },
          },
        };
      },
    },
    routeProvider: {
      async walking() {
        throw new Error('unexpected');
      },
    },
    transitRouteProvider: {
      async transit(_origin, destination) {
        transitDestinations.push(destination);
        return {
          status: 'fresh',
          durationSeconds: 1080,
          boardingCount: 1,
          lineIdentities: ['Line A'],
          transferCount: 0,
          checkedAt: now,
          attribution: { label: 'Google Maps', url: 'https://google.com/maps' },
        };
      },
    },
    clock: { now: () => new Date(now) },
  });
  const result = await recommend.ask({
    query: '新宿駅から電車20分以内のラーメン',
    replies: [],
  });
  assert.equal(result.status, 'recommend');
  assert.deepEqual(transitDestinations, [
    { latitude: 35.7, longitude: 139.76 },
  ]);
  assert.equal(result.recommendations[0].name, '麺 空');
  assert.deepEqual(result.recommendations[0].routeClaim, {
    mode: 'transit',
    seconds: 1080,
  });
});

test('a verified absent direct train is distinct from a transit provider outage', async () => {
  const transit = { status: 'no_direct_route', checkedAt: now };
  const recommend = createRecommendConversationService({
    catalog: {
      async list() {
        return [item('ramen', '麺 空', '新宿', ['ラーメン'])];
      },
    },
    interpreter: {
      async interpret() {
        return {
          action: 'recommend',
          originText: '新宿駅',
          originKind: 'station',
          foodTerms: ['ramen'],
          excludedFoodTerms: [],
          travelMode: 'transit',
          maxMinutes: 20,
          visited: 'any',
        };
      },
    },
    locationResolver: {
      async resolve() {
        return {
          status: 'resolved',
          location: {
            canonicalAddress: '新宿駅',
            point: { latitude: 35.69, longitude: 139.7 },
          },
        };
      },
    },
    routeProvider: {
      async walking() {
        throw new Error('unexpected');
      },
    },
    transitRouteProvider: {
      async transit() {
        return transit;
      },
    },
    clock: { now: () => new Date(now) },
  });
  const request = { query: '新宿駅から電車20分以内のラーメン', replies: [] };
  assert.equal((await recommend.ask(request)).status, 'no_results');
  transit.status = 'unavailable';
  assert.equal((await recommend.ask(request)).status, 'unavailable');
  transit.status = 'no_direct_route';
  transit.checkedAt = '2026-09-29T23:00:00.000Z';
  assert.equal((await recommend.ask(request)).status, 'unavailable');
});

test('transit search continues beyond the first nearby group when no direct route exists', async () => {
  const candidates = Array.from({ length: 6 }, (_, index) =>
    item(
      `ramen-${index}`,
      `麺 ${index}`,
      '新宿',
      ['ラーメン'],
      35.691 + index * 0.001,
    ),
  );
  let calls = 0;
  let directEnabled = true;
  const recommend = createRecommendConversationService({
    catalog: {
      async list() {
        return candidates;
      },
    },
    interpreter: {
      async interpret() {
        return {
          action: 'recommend',
          originText: '新宿駅',
          originKind: 'station',
          foodTerms: ['ramen'],
          excludedFoodTerms: [],
          travelMode: 'transit',
          maxMinutes: 20,
          visited: 'any',
        };
      },
    },
    locationResolver: {
      async resolve() {
        return {
          status: 'resolved',
          location: {
            canonicalAddress: '新宿駅',
            point: { latitude: 35.69, longitude: 139.7 },
          },
        };
      },
    },
    routeProvider: {
      async walking() {
        throw new Error('unexpected');
      },
    },
    transitRouteProvider: {
      async transit(_origin, destination) {
        calls += 1;
        return directEnabled && destination.latitude === candidates[5].latitude
          ? {
              status: 'fresh',
              durationSeconds: 1100,
              boardingCount: 1,
              transferCount: 0,
              lineIdentities: ['Line A'],
              checkedAt: now,
              attribution: {
                label: 'Google Maps',
                url: 'https://google.com/maps',
              },
            }
          : { status: 'no_direct_route', checkedAt: now };
      },
    },
    clock: { now: () => new Date(now) },
  });
  const result = await recommend.ask({
    query: '新宿駅から電車20分以内のラーメン',
    replies: [],
  });
  assert.equal(result.status, 'recommend');
  assert.equal(result.recommendations[0].itemId, 'ramen-5');
  assert.equal(calls, 6);
  directEnabled = false;
  candidates.push(
    ...Array.from({ length: 5 }, (_, index) =>
      item(
        `ramen-${index + 6}`,
        `麺 ${index + 6}`,
        '新宿',
        ['ラーメン'],
        35.697 + index * 0.001,
      ),
    ),
  );
  calls = 0;
  assert.equal(
    (
      await recommend.ask({
        query: '新宿駅から電車20分以内のラーメン',
        replies: [],
      })
    ).status,
    'unavailable',
  );
  assert.equal(calls, 10);
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

test('a full Maps place URL can supply an encoded place-name origin', async () => {
  let geocoded = false;
  const recommend = createRecommendConversationService({
    catalog: {
      async list() {
        return [item('nearby-coffee', '喫茶 青葉', '新宿', ['coffee'])];
      },
    },
    interpreter: {
      async interpret() {
        return {
          action: 'recommend',
          originText: '未保存の店',
          originKind: 'place',
          foodTerms: ['coffee'],
          excludedFoodTerms: [],
          travelMode: 'none',
          maxMinutes: null,
          visited: 'prefer_unvisited',
        };
      },
    },
    locationResolver: {
      async resolve(locationHint) {
        assert.equal(locationHint, '未保存の店');
        geocoded = true;
        return {
          status: 'resolved',
          location: {
            canonicalAddress: '新宿',
            point: { latitude: 35.67, longitude: 139.76 },
          },
          attribution: { label: 'Google Maps', url: 'https://google.com/maps' },
        };
      },
    },
    routeProvider: {
      async walking() {
        throw new Error('unexpected');
      },
    },
    clock: { now: () => new Date(now) },
  });
  const result = await recommend.ask({
    query: `https://www.google.com/maps/place/${encodeURIComponent('未保存の店')}`,
    replies: [],
  });
  assert.equal(geocoded, true);
  assert.equal(result.status, 'recommend');
  assert.equal(result.recommendations[0].itemId, 'nearby-coffee');
  assert.equal(result.recommendations[0].routeClaim, undefined);
});
