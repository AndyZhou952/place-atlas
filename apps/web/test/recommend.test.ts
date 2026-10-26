// The Recommend harness wired through the Worker: the model only interprets the request;
// candidates come from the saved catalog, so an invented restaurant can never be recommended.
import assert from 'node:assert/strict';
import test from 'node:test';
import { foodKey, itemFoodKeys } from '../src/server/agent/recommend/food.ts';
import { normalizeRecommendIntent } from '../src/server/agent/recommend/intent.ts';
import type { RouteSidecarServiceBinding } from '../src/server/agent/recommend/routes.ts';
import { GOOGLE_ROUTE_SIDECAR_ATTRIBUTION } from '../route-sidecar/contract.ts';
import type { Env } from '../src/server/env.ts';
import { handleApi } from '../src/server/worker.ts';
import { migratedD1, stubFetch } from './fixtures.ts';

const ORIGIN = 'https://atlas.test';

function restaurant(id: string, title: string, tags: string[], latitude: number, area = '新宿') {
  return {
    id,
    kind: 'food',
    title,
    area,
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

async function ask(
  interpretation: unknown,
  query: string,
  replies: string[] = [],
  routes?: RouteSidecarServiceBinding,
) {
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
  // Saved restaurants whose area is a station's name.
  for (const [id, area] of [
    ['ramen-c', '東京駅'],
    ['ramen-d', 'Tokyo Station'],
  ])
    insert.run(
      id,
      JSON.stringify(restaurant(id, `合成ラーメン ${id}`, ['ラーメン'], 35.681, area)),
    );
  const env: Env = {
    DB: db,
    ...(routes ? { ROUTE_SIDECAR: routes } : {}),
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
  const response = await request('POST', '/api/recommend', { query, replies }, cookie);
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
  const ids = body.recommendations.map((item: { itemId: string }) => item.itemId);
  assert.ok(ids.includes('ramen-a') && !ids.includes('sushi-b'), ids.join());
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

/** A route sidecar that geocodes any starting point near Tokyo Station and walks 5 minutes. */
function walkingRoutes(hints: string[]): RouteSidecarServiceBinding {
  const evidence = () => ({
    attribution: GOOGLE_ROUTE_SIDECAR_ATTRIBUTION,
    source: { providerId: 'google-maps-platform' as const, endpoint: 'test' },
    checkedAt: new Date().toISOString(),
  });
  return {
    async geocode({ locationHint }) {
      hints.push(locationHint);
      return {
        ok: true,
        evidence: {
          candidates: [
            { formattedAddress: locationHint, point: { latitude: 35.6812, longitude: 139.7671 } },
          ],
          ...evidence(),
        },
      };
    },
    async walkingMatrix({ destinations }) {
      return {
        ok: true,
        evidence: {
          routes: destinations.map((_, destinationIndex) => ({
            destinationIndex,
            durationSeconds: 300,
            distanceMeters: 400,
          })),
          ...evidence(),
        },
      };
    },
  };
}

const walk = { ...interpretation, travelMode: 'walk', maxMinutes: 10 };

test('a named station starts a walking route even when saved restaurants use it as their area', async () => {
  const hints: string[] = [];
  const { body } = await ask(walk, '東京駅から歩いて10分のラーメン', [], walkingRoutes(hints));
  assert.equal(body.status, 'recommend', JSON.stringify(body));
  assert.deepEqual(hints, ['東京駅']);
});

test('the exact starting point answers the area question instead of repeating it', async () => {
  const hints: string[] = [];
  const query = '歩いて10分以内のラーメン';
  const routes = walkingRoutes(hints);
  // An area answer asks for the exact point once...
  const area = await ask(walk, query, ['Tokyo Station area'], routes);
  assert.equal(area.body.status, 'clarify');
  assert.equal(area.body.clarification, 'exact_origin');
  // ...and the exit then given is resolved within that area.
  const exact = await ask(walk, query, ['Tokyo Station area', 'Marunouchi North Entrance'], routes);
  assert.equal(exact.body.status, 'recommend', JSON.stringify(exact.body));
  assert.deepEqual(hints, ['Tokyo Station Marunouchi North Entrance']);
  // Naming the station itself is already an exact starting point.
  hints.length = 0;
  const station = await ask(walk, query, ['Tokyo Station'], routes);
  assert.equal(station.body.status, 'recommend', JSON.stringify(station.body));
  assert.deepEqual(hints, ['Tokyo Station']);
});

test('only a car request is a driving request: 電車で and 自転車で are not', async () => {
  const intent = (query: string) =>
    normalizeRecommendIntent([query], [], { ...interpretation, travelMode: 'transit' });
  assert.equal(intent('車で10分のラーメン').reason, 'driving_route_unavailable');
  assert.equal(intent('電車で20分のラーメン').reason, undefined);
  assert.equal(intent('自転車で10分のラーメン').reason, undefined);
  const { body } = await ask(
    { ...interpretation, travelMode: 'transit', maxMinutes: 20 },
    '東京駅から電車で20分のラーメン',
    [],
    walkingRoutes([]),
  );
  assert.equal(body.status, 'unavailable');
  assert.match(body.message, /Train route times in Japan/u);
});
