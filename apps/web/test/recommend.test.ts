// The Recommend harness wired through the Worker: the model only interprets the request;
// candidates come from the saved catalog, so an invented restaurant can never be recommended.
import assert from 'node:assert/strict';
import test from 'node:test';
import { foodKey, itemFoodKeys } from '../src/server/agent/recommend/food.ts';
import type { Env } from '../src/server/env.ts';
import { handleApi } from '../src/server/worker.ts';
import { migratedD1, stubFetch } from './fixtures.ts';

const ORIGIN = 'https://atlas.test';

function restaurant(id: string, title: string, tags: string[], latitude: number) {
  return {
    id,
    kind: 'food',
    title,
    area: '新宿',
    address: '東京都新宿区西新宿1-1-1',
    description: '',
    latitude,
    longitude: 139.7,
    verificationStatus: 'verified',
    verifiedAt: '2026-10-01T00:00:00.000Z',
    reservation: { mode: 'unknown', label: '' },
    personalState: 'saved',
    tags,
    sources: [],
  };
}

async function ask(interpretation: unknown, query: string) {
  const { db, sqlite } = migratedD1();
  const insert = sqlite.prepare(
    `INSERT INTO atlas_items (id, payload_json, verification_status, created_at, updated_at)
     VALUES (?, ?, 'verified', '2026-10-01', '2026-10-01')`,
  );
  insert.run(
    'ramen-a',
    JSON.stringify(restaurant('ramen-a', '合成ラーメン A', ['ラーメン'], 35.69)),
  );
  insert.run('sushi-b', JSON.stringify(restaurant('sushi-b', '合成鮨 B', ['寿司'], 35.6)));
  const env: Env = {
    DB: db,
    MEDIA: {} as R2Bucket,
    ATLAS_OWNER_PASSWORD: 'owner-pass',
    ATLAS_OWNER_SESSION_SECRET: 'x'.repeat(40),
    AGENT_API_KEY: 'model-key',
    AGENT_BASE_URL: 'https://api.deepseek.com',
    AGENT_MODEL: 'deepseek-flash',
  };
  globalThis.fetch = stubFetch({
    'https://api.deepseek.com/chat/completions': () =>
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(interpretation) } }],
      }),
  });
  const request = (method: string, path: string, body: unknown, cookie = '') =>
    handleApi(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: { origin: ORIGIN, 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
      env,
    );
  const login = await request('POST', '/api/session', { password: 'owner-pass' });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const response = await request('POST', '/api/recommend', { query, replies: [] }, cookie);
  // oxlint-disable-next-line typescript/no-explicit-any -- assertions inspect the JSON
  const body: any = await response.json();
  return { status: response.status, body };
}

const interpretation = {
  action: 'recommend',
  originId: null,
  originText: null,
  foodTerms: ['ramen'],
  excludedFoodTerms: [],
  travelMode: 'none',
  maxMinutes: null,
  visited: 'any',
};

test('a food-only request recommends only matching saved restaurants', async () => {
  const { status, body } = await ask(interpretation, 'ラーメンが食べたい');
  assert.equal(status, 200);
  assert.equal(body.status, 'recommend');
  assert.deepEqual(
    body.recommendations.map((item: { itemId: string }) => item.itemId),
    ['ramen-a'],
  );
});

test('a timed route without a starting point asks for one instead of guessing', async () => {
  const { body } = await ask(
    { ...interpretation, travelMode: 'walk', maxMinutes: 10 },
    '歩いて10分以内のラーメン',
  );
  assert.equal(body.status, 'clarify');
});

test('cuisines beyond the six dish terms match saved labels; unknown cuisines match nothing', () => {
  assert.equal(foodKey('カレー'), 'curry');
  assert.equal(foodKey('French'), 'french');
  assert.equal(foodKey('pizza'), 'italian.pizza');
  assert.ok(itemFoodKeys(['フレンチビストロ']).includes('french'));
  assert.ok(itemFoodKeys(['ピザ']).includes('italian.pizza'));
  assert.ok(!itemFoodKeys(['ラーメン', '居酒屋']).includes(foodKey('Vietnamese')));
});
