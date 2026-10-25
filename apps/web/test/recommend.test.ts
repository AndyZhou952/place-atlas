import assert from 'node:assert/strict';
import test from 'node:test';
import { type RecommendDeps, recommend } from '../src/server/agent/recommend.ts';
import type { Restaurant } from '../src/shared/types.ts';
import { chatResponse, stubFetch } from './fixtures.ts';

const restaurant = (
  id: string,
  title: string,
  tags: string[],
  latitude: number,
  extra: Partial<Restaurant> = {},
): Restaurant => ({
  id,
  title,
  area: '新宿',
  address: '東京都新宿区',
  description: '',
  latitude,
  longitude: 139.7,
  tags,
  cuisines: [],
  reservation: { policy: 'unknown', label: '' },
  addedAt: '2026-10-01',
  updatedAt: '2026-10-01',
  favorite: false,
  visited: false,
  ...extra,
});
const saved = [
  restaurant('a', 'カレーA', ['カレー'], 35.7, { rating: 9, visited: true }),
  restaurant('b', 'カレーB', ['カレー'], 35.69),
  restaurant('c', '鮨C', ['寿司'], 35.6),
];
const model = { apiKey: 'k', baseUrl: 'https://model.test/v1', model: 'm' };
const ask = (
  answer: unknown,
  geocode: RecommendDeps['geocode'] = async () => ({
    label: '新宿駅',
    latitude: 35.69,
    longitude: 139.7,
  }),
) =>
  recommend('新宿駅の近くでカレー', saved, {
    model,
    geocode,
    fetch: stubFetch({ 'https://model.test/': () => chatResponse(answer) }),
  });

test('model picks are limited to saved ids, deduplicated, and sorted by distance from the origin', async () => {
  const result = await ask({
    origin: '新宿駅',
    picks: [
      { id: 'a', reason: '高評価' },
      { id: 'invented', reason: 'x' },
      { id: 'b', reason: '未訪問' },
      { id: 'a', reason: 'again' },
    ],
  });
  assert.deepEqual(result.origin, { label: '新宿駅', latitude: 35.69, longitude: 139.7 });
  assert.deepEqual(
    result.picks.map((pick) => [pick.id, pick.distanceKm]),
    [
      ['b', 0],
      ['a', 1.1],
    ],
  );
});

test('an origin that cannot be geocoded leaves the model order without distances', async () => {
  const result = await ask(
    {
      origin: 'どこか',
      picks: [
        { id: 'a', reason: '' },
        { id: 'b', reason: '' },
      ],
    },
    async () => undefined,
  );
  assert.equal(result.origin, undefined);
  assert.deepEqual(
    result.picks.map((pick) => [pick.id, pick.distanceKm]),
    [
      ['a', undefined],
      ['b', undefined],
    ],
  );
});

test('no picks returns a message', async () => {
  assert.match((await ask({ picks: [], message: '該当なし' })).message!, /該当なし/u);
});

test('without a model, keywords match and unvisited, higher-rated places come first', async () => {
  const result = await recommend('カレー', saved, { geocode: async () => undefined });
  assert.deepEqual(
    result.picks.map((pick) => pick.id),
    ['b', 'a'],
  );
});
