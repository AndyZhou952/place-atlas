// Visits through the Worker: only published restaurants' visits and photos are public, and a
// visit's score change is written only together with that visit.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Env } from '../src/server/env.ts';
import { handleApi } from '../src/server/worker.ts';
import { migratedD1 } from './fixtures.ts';

const ORIGIN = 'https://atlas.test';
const at = '2026-10-01T00:00:00.000Z';
const restaurant = (id: string, verificationStatus: string) => ({
  id,
  kind: 'food',
  title: `合成食堂 ${id}`,
  area: '中目黒',
  address: '東京都目黒区中目黒1-2-3',
  description: '',
  latitude: 35.6441,
  longitude: 139.6988,
  verificationStatus,
  verifiedAt: at,
  personalState: 'saved',
  tags: ['定食'],
  reservation: { mode: 'unknown', label: 'Reservation status is unknown.' },
  sources: [],
});

function setup() {
  const { db, sqlite } = migratedD1();
  const objects = new Map([
    ['media/published', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    ['media/candidate', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
  ]);
  const env: Env = {
    DB: db,
    MEDIA: {
      async get(key: string) {
        const bytes = objects.get(key);
        return bytes ? { body: bytes, httpEtag: '"e"' } : null;
      },
    } as unknown as R2Bucket,
    ATLAS_OWNER_PASSWORD: 'owner-pass',
    ATLAS_OWNER_SESSION_SECRET: 'x'.repeat(40),
  };
  sqlite
    .prepare(
      `INSERT INTO atlas_items (id, payload_json, verification_status, created_at, updated_at)
       VALUES ('published', ?, 'verified', ?, ?)`,
    )
    .run(JSON.stringify(restaurant('published', 'verified')), at, at);
  // An unpublished 0.1 review candidate, with a visit and a photo of its own.
  sqlite
    .prepare(
      `INSERT INTO atlas_review_candidates (id, payload_json, created_at, updated_at)
       VALUES ('candidate', ?, ?, ?)`,
    )
    .run(JSON.stringify(restaurant('candidate', 'needs_review')), at, at);
  for (const item of ['published', 'candidate']) {
    sqlite
      .prepare(
        `INSERT INTO visits (id, item_id, item_title, visited_at, note, created_at, updated_at)
         VALUES (?, ?, ?, '2026-09-01', ?, ?, ?)`,
      )
      .run(`visit-${item}`, item, item, `note ${item}`, at, at);
    sqlite
      .prepare(
        `INSERT INTO visit_media (id, visit_id, item_id, object_key, original_filename, content_type,
           byte_size, content_sha256, display_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'a.png', 'image/png', 4, 'h', ?, ?, ?)`,
      )
      .run(`m-${item}`, `visit-${item}`, item, `media/${item}`, `pm_${item}`, at, at);
  }
  let cookie = '';
  const call = async (method: string, path: string, payload?: unknown) => {
    const response = await handleApi(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      }),
      env,
    );
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return response;
  };
  return { call };
}

test('anonymous visits and photos are limited to published restaurants', async () => {
  const { call } = setup();
  const visits = (await (await call('GET', '/api/visits')).json()) as { id: string }[];
  assert.deepEqual(
    visits.map((visit) => visit.id),
    ['visit-published'],
  );
  assert.equal(JSON.stringify(visits).includes('note candidate'), false);
  assert.equal((await call('GET', '/api/media/pm_published/content')).status, 200);
  assert.equal((await call('GET', '/api/media/pm_candidate/content')).status, 404);
});

test("a visit's score is written only with that visit", async () => {
  const { call } = setup();
  await call('POST', '/api/session', { password: 'owner-pass' });
  const score = async () =>
    (
      (await (await call('GET', '/api/restaurants')).json()) as { id: string; rating?: number }[]
    ).find((item) => item.id === 'published')?.rating;
  const create = {
    id: 'visit-new-0001',
    restaurantId: 'published',
    visitedOn: '2026-10-01',
    rating: 6,
  };
  assert.equal((await call('POST', '/api/visits', create)).status, 201);
  assert.equal(await score(), 6);

  await call('PATCH', '/api/restaurants/published', { rating: 9 });
  // Retrying the original create leaves the newer score alone.
  assert.equal((await call('POST', '/api/visits', create)).status, 201);
  assert.equal(await score(), 9);

  const missing = await call('PATCH', '/api/visits/visit-missing-01', {
    restaurantId: 'published',
    visitedOn: '2026-10-01',
    rating: 2,
  });
  assert.equal(missing.status, 404);
  assert.equal(await score(), 9);
});
