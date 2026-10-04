// Opt-in, real D1/R2 acceptance. Only this run's Visit/media IDs are deleted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
if (
  process.env.ALLOW_RECORD_SMOKE_WRITES !== 'yes' ||
  !process.env.OWNER_TEST_PASSWORD
)
  throw Error('Explicit write opt-in and owner test password required');
const base = process.env.ATLAS_BASE_URL || 'http://localhost:3000';
const login = await fetch(`${base}/api/auth/owner`, {
  method: 'POST',
  headers: { origin: base, 'content-type': 'application/json' },
  body: JSON.stringify({ password: process.env.OWNER_TEST_PASSWORD }),
});
assert.equal(login.status, 200);
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
async function read(path) {
  const r = await fetch(base + path, { headers: { cookie } });
  assert.equal(r.status, 200);
  return r.json();
}
async function write(path, method, data, mutationId = randomUUID()) {
  const form = data instanceof FormData;
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie,
      origin: base,
      'x-atlas-mutation-id': mutationId,
      ...(form ? {} : { 'content-type': 'application/json' }),
    },
    ...(data === undefined ? {} : { body: form ? data : JSON.stringify(data) }),
  });
  assert.ok(r.ok, `${method} ${path}: ${r.status} ${await r.clone().text()}`);
  return r.json();
}
const items = await read('/api/items');
const item = items.find((i) => i.kind === 'food' && i.tabelog);
assert.ok(item);
const assessment = await read(`/api/items/${item.id}/personal`);
const id = `record-smoke-${randomUUID()}`;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const mediaIds = [];
let created = false;
try {
  const mutationId = randomUUID();
  const input = { id, itemId: item.id, visitedAt: '2026-09-20' };
  created = true;
  console.log(`Temporary Visit ID: ${id}`);
  await write('/api/journal', 'POST', input, mutationId);
  await write('/api/journal', 'POST', input, mutationId);
  const visits = await read('/api/journal');
  assert.equal(visits.filter((v) => v.id === id).length, 1);
  console.log(
    'PASS date-only Visit and identical-mutation replay without duplication',
  );
  for (let n = 0; n < 2; n++) {
    const mediaId = `${id}-photo-${n}`;
    mediaIds.push(mediaId);
    const form = new FormData();
    form.append('visitId', id);
    form.append('ids', mediaId);
    form.append('captions', `Test photo ${n}`);
    form.append(
      'files',
      new Blob([png], { type: 'image/png' }),
      `${mediaId}.png`,
    );
    await write('/api/media', 'POST', form);
  }
  await write(`/api/media/${mediaIds[0]}`, 'PATCH', {
    caption: 'Updated test caption',
  });
  await write(`/api/journal/${id}`, 'PATCH', {
    visitedAt: '2026-09-21',
    note: 'Temporary Record acceptance note',
  });
  const media = await read(`/api/media?visitId=${id}`);
  assert.equal(media.length, 2);
  assert.equal(
    media.find((m) => m.id === mediaIds[0]).caption,
    'Updated test caption',
  );
  for (const m of media) {
    const r = await fetch(new URL(m.contentUrl, base), { headers: { cookie } });
    assert.equal(r.status, 200);
    assert.ok((await r.arrayBuffer()).byteLength > 0);
  }
  const visit = (await read('/api/journal')).find((v) => v.id === id);
  assert.equal(visit.visitedOn, '2026-09-21');
  assert.equal(
    visit.displayNote ?? visit.note,
    'Temporary Record acceptance note',
  );
  const fresh = (await read('/api/items')).find((i) => i.id === item.id);
  assert.deepEqual(fresh.tabelog, item.tabelog);
  assert.deepEqual(fresh.googleRating, item.googleRating);
  const after = await read(`/api/items/${item.id}/personal`);
  assert.equal(after.personalRating, assessment.personalRating);
  assert.equal(after.favorite, assessment.favorite);
  console.log(
    'PASS two R2 photos, caption/date/note edits, fresh reads and unchanged ratings/favorite',
  );
  const testRating = assessment.personalRating === 3.7 ? 3.8 : 3.7;
  await write(`/api/journal/${id}`, 'PATCH', {
    visitedAt: '2026-09-21',
    rating: testRating,
    note: 'Temporary Record acceptance note',
  });
  assert.equal(
    (await read(`/api/items/${item.id}/personal`)).personalRating,
    testRating,
  );
  const rated = (await read('/api/items')).find((i) => i.id === item.id);
  assert.deepEqual(rated.tabelog, item.tabelog);
  assert.deepEqual(rated.googleRating, item.googleRating);
  console.log('PASS changing personal score preserves external ratings');
  await write(`/api/media/${mediaIds[0]}`, 'DELETE');
  assert.equal((await read(`/api/media?visitId=${id}`)).length, 1);
  const anonymous = await fetch(`${base}/api/journal/${id}`, {
    method: 'PATCH',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ visitedAt: '2026-09-22' }),
  });
  assert.equal(anonymous.status, 401);
  console.log('PASS single-photo deletion and anonymous write rejection');
} finally {
  if (created) {
    await write(`/api/journal/${id}`, 'PATCH', {
      visitedAt: '2026-09-21',
      rating: assessment.personalRating ?? null,
    });
    await write(`/api/journal/${id}`, 'DELETE');
    assert.equal(
      (await read('/api/journal')).some((v) => v.id === id),
      false,
    );
    assert.deepEqual(await read(`/api/media?visitId=${id}`), []);
    const after = await read(`/api/items/${item.id}/personal`);
    assert.equal(after.effectiveVisited, assessment.effectiveVisited);
    assert.equal(after.personalRating, assessment.personalRating);
    console.log(`CLEANED temporary Visit and photos: ${id}`);
  }
}
