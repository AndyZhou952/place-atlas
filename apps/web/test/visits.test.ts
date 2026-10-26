// Visits through the Worker: only published restaurants' visits and photos are public, a visit's
// score change is written only together with that visit, and a photo upload is idempotent and
// leaves no object behind when it fails.
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
  const writes = { puts: 0, deletes: 0, failPut: 0, failBatch: false };
  // Steps run before the next batches, in order: a step can pause a commit or make it fail.
  const batchSteps: (() => Promise<void>)[] = [];
  const env: Env = {
    DB: new Proxy(db, {
      get(target, property) {
        if (property === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            if (writes.failBatch) throw new Error('database unavailable');
            await batchSteps.shift()?.();
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }),
    MEDIA: {
      async get(key: string) {
        const bytes = objects.get(key);
        return bytes ? { body: bytes, httpEtag: '"e"' } : null;
      },
      async put(key: string, bytes: Uint8Array<ArrayBuffer>) {
        writes.puts++;
        // The nth put of this request fails, after the others have completed.
        if (writes.failPut && writes.puts === writes.failPut) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw new Error('bucket unavailable');
        }
        objects.set(key, bytes);
      },
      async delete(key: string) {
        writes.deletes++;
        objects.delete(key);
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
  /** The Owner's upload form: one file per id. */
  const upload = (visitId: string, files: [id: string, bytes: number[]][]) => {
    const form = new FormData();
    for (const [id, bytes] of files) {
      form.append('files', new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' }));
      form.append('ids', id);
    }
    return handleApi(
      new Request(`${ORIGIN}/api/visits/${visitId}/media`, {
        method: 'POST',
        headers: { origin: ORIGIN, cookie },
        body: form,
      }),
      env,
    );
  };
  const rows = () =>
    sqlite
      .prepare("SELECT id, object_key, display_id FROM visit_media WHERE id LIKE 'upload-%'")
      .all() as { id: string; object_key: string; display_id: string }[];
  return { call, upload, objects, writes, batchSteps, rows };
}

const png = (last: number) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, last];

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

test('an upload id is a retry key: the same file is reused, another file is refused unwritten', async () => {
  const { call, upload, objects, writes, rows } = setup();
  await call('POST', '/api/session', { password: 'owner-pass' });
  const first = await upload('visit-published', [['upload-0001', png(1)]]);
  assert.equal(first.status, 201);
  const [media] = (await first.json()) as { id: string }[];
  assert.equal(writes.puts, 1);
  const stored = [...objects].find(([key]) => key.includes('upload-0001'));

  const retry = await upload('visit-published', [['upload-0001', png(1)]]);
  assert.equal(retry.status, 201);
  assert.deepEqual(
    ((await retry.json()) as { id: string }[]).map(({ id }) => id),
    [media.id],
  );
  assert.equal(writes.puts, 1, 'an identical retry writes nothing');

  for (const [visitId, bytes] of [
    ['visit-published', png(2)],
    ['visit-candidate', png(1)],
  ] as const) {
    const changed = await upload(visitId, [['upload-0001', bytes]]);
    assert.equal(changed.status, 409, visitId);
  }
  assert.equal(writes.puts, 1, 'a changed file or another visit writes nothing');
  assert.deepEqual(
    [...objects].find(([key]) => key.includes('upload-0001')),
    stored,
  );
  assert.equal(rows().length, 1);

  // Two overlapping attempts with different files: one commits, the other is refused and its
  // object removed, so the stored bytes are the committed row's.
  const racing = await Promise.all([
    upload('visit-published', [['upload-0005', png(3)]]),
    upload('visit-published', [['upload-0005', png(4)]]),
  ]);
  assert.deepEqual(racing.map(({ status }) => status).sort(), [201, 409]);
  const raced = [...objects.keys()].filter((key) => key.includes('upload-0005'));
  assert.deepEqual(raced, [rows().find(({ id }) => id === 'upload-0005')?.object_key]);
});

test('a failed upload removes the objects it wrote', async () => {
  const { call, upload, objects, writes, rows } = setup();
  await call('POST', '/api/session', { password: 'owner-pass' });
  const uploaded = () => [...objects.keys()].filter((key) => key.includes('upload-'));

  writes.failBatch = true;
  assert.equal((await upload('visit-published', [['upload-0002', png(1)]])).status, 500);
  writes.failBatch = false;
  assert.deepEqual([writes.puts, writes.deletes], [1, 1]);
  assert.deepEqual(uploaded(), []);

  // One of two writes fails after the other completed.
  writes.puts = 0;
  writes.failPut = 2;
  assert.equal(
    (
      await upload('visit-published', [
        ['upload-0003', png(1)],
        ['upload-0004', png(2)],
      ])
    ).status,
    500,
  );
  writes.failPut = 0;
  assert.deepEqual(uploaded(), []);
  assert.equal(rows().length, 0);

  // The retry then succeeds.
  assert.equal((await upload('visit-published', [['upload-0002', png(1)]])).status, 201);
  assert.equal(uploaded().length, 1);
});

test('an identical upload in flight never loses its object to a failing retry', async () => {
  const { call, upload, objects, batchSteps, rows } = setup();
  await call('POST', '/api/session', { password: 'owner-pass' });
  const deferred = () => {
    let resolve = () => {};
    const promise = new Promise<void>((done) => (resolve = done));
    return { promise, resolve };
  };
  const opened = async (id: string) => {
    const row = rows().find((media) => media.id === id);
    return (await call('GET', `/api/media/${row?.display_id}/content`)).status;
  };

  // A writes its object and pauses before its commit; the identical retry B fails its commit and
  // cleans up; then A commits.
  const paused = deferred();
  const resume = deferred();
  batchSteps.push(
    async () => {
      paused.resolve();
      await resume.promise;
    },
    async () => {
      throw new Error('database unavailable');
    },
  );
  const first = upload('visit-published', [['upload-0006', png(1)]]);
  await paused.promise;
  assert.equal((await upload('visit-published', [['upload-0006', png(1)]])).status, 500);
  resume.resolve();
  assert.equal((await first).status, 201);
  assert.equal(await opened('upload-0006'), 200);

  // B writes before A commits; A then commits, and only afterwards does B's commit fail.
  const aWaiting = deferred();
  const bWritten = deferred();
  const aDone = deferred();
  batchSteps.push(
    async () => {
      aWaiting.resolve();
      await bWritten.promise;
    },
    async () => {
      bWritten.resolve();
      await aDone.promise;
      throw new Error('database unavailable');
    },
  );
  const a = upload('visit-published', [['upload-0007', png(2)]]);
  await aWaiting.promise;
  const b = upload('visit-published', [['upload-0007', png(2)]]);
  assert.equal((await a).status, 201);
  aDone.resolve();
  assert.equal((await b).status, 500);
  assert.equal(await opened('upload-0007'), 200);

  // Both identical attempts commit: the later one reuses the first row and drops its own copy.
  const [one, two] = await Promise.all([
    upload('visit-published', [['upload-0008', png(3)]]),
    upload('visit-published', [['upload-0008', png(3)]]),
  ]);
  assert.deepEqual([one.status, two.status], [201, 201]);
  assert.deepEqual(
    ((await one.json()) as { id: string }[]).map(({ id }) => id),
    ((await two.json()) as { id: string }[]).map(({ id }) => id),
  );
  assert.deepEqual(
    [...objects.keys()].filter((key) => key.includes('upload-0008')),
    [rows().find(({ id }) => id === 'upload-0008')?.object_key],
  );
  assert.equal(await opened('upload-0008'), 200);
});
