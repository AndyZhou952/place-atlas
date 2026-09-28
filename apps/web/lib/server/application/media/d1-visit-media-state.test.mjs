import assert from 'node:assert/strict';
import test from 'node:test';

import { D1VisitMediaState } from './d1-visit-media-state.ts';

const row = {
  id: 'media-1',
  display_id: 'pm_opaque_1',
  visit_id: 'visit-1',
  item_id: 'item-1',
  object_key: 'visits/visit-1/media-1',
  original_filename: 'sushi.jpg',
  content_type: 'image/jpeg',
  byte_size: 123,
  content_sha256: 'sha-1',
  caption: null,
  display_order: 2,
  created_at: '2026-09-10T08:00:00.000Z',
  updated_at: '2026-09-10T08:00:00.000Z',
};

test('the D1 VisitMedia adapter filters by Visit and item with legacy ordering', async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      calls.push({ sql, values: [] });
      return {
        bind(...values) {
          calls.at(-1).values = values;
          return this;
        },
        async all() {
          return { results: [row] };
        },
      };
    },
  };

  const records = await new D1VisitMediaState(database).list({
    visitId: 'visit-1',
    itemId: 'item-1',
  });

  assert.deepEqual(calls[0].values, ['visit-1', 'item-1']);
  assert.match(calls[0].sql, /WHERE visit_id = \? AND item_id = \?/u);
  assert.match(calls[0].sql, /ORDER BY visit_id, display_order, created_at/u);
  assert.deepEqual(records, [
    {
      id: 'media-1',
      displayId: 'pm_opaque_1',
      visitId: 'visit-1',
      itemId: 'item-1',
      objectKey: 'visits/visit-1/media-1',
      originalFilename: 'sushi.jpg',
      contentType: 'image/jpeg',
      byteSize: 123,
      contentSha256: 'sha-1',
      caption: undefined,
      displayOrder: 2,
      createdAt: '2026-09-10T08:00:00.000Z',
      updatedAt: '2026-09-10T08:00:00.000Z',
    },
  ]);
});

test('the D1 VisitMedia adapter looks up metadata by stable media ID', async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      calls.push({ sql, values: [] });
      return {
        bind(...values) {
          calls.at(-1).values = values;
          return this;
        },
        async first() {
          return row;
        },
      };
    },
  };

  const record = await new D1VisitMediaState(database).find('media-1');

  assert.match(calls[0].sql, /WHERE id = \?/u);
  assert.deepEqual(calls[0].values, ['media-1']);
  assert.equal(record.objectKey, 'visits/visit-1/media-1');
});

test('the D1 adapter reads Visit ordering context and atomically inserts metadata', async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return this;
        },
        async first() {
          return { item_id: 'item-1', next_display_order: 3 };
        },
      };
    },
    async batch(statements) {
      assert.equal(statements.length, 1);
    },
  };
  const state = new D1VisitMediaState(database);

  assert.deepEqual(await state.getVisitContext('visit-1'), {
    itemId: 'item-1',
    nextDisplayOrder: 3,
  });
  await state.insert([
    {
      id: 'media-1',
      displayId: 'pm_opaque_1',
      visitId: 'visit-1',
      itemId: 'item-1',
      objectKey: 'visits/visit-1/media-1',
      originalFilename: 'sushi.jpg',
      contentType: 'image/jpeg',
      byteSize: 123,
      contentSha256: 'sha-1',
      caption: '鮨',
      displayOrder: 3,
      createdAt: '2026-09-12T08:00:00.000Z',
      updatedAt: '2026-09-12T08:00:00.000Z',
    },
  ]);

  assert.match(calls[0].sql, /FROM visits/u);
  assert.deepEqual(calls[0].values, ['visit-1']);
  assert.match(calls[1].sql, /INSERT INTO visit_media/u);
  assert.deepEqual(calls[1].values, [
    'media-1',
    'pm_opaque_1',
    'visit-1',
    'item-1',
    'visits/visit-1/media-1',
    'sushi.jpg',
    'image/jpeg',
    123,
    'sha-1',
    '鮨',
    null,
    3,
    '2026-09-12T08:00:00.000Z',
    '2026-09-12T08:00:00.000Z',
  ]);
});

test('the D1 adapter updates a caption and returns the stored metadata', async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return this;
        },
        async first() {
          return { ...row, caption: '鮨 course', updated_at: 'updated' };
        },
      };
    },
  };

  const result = await new D1VisitMediaState(database).updateCaption(
    'media-1',
    '鮨 course',
    'updated',
  );

  assert.match(
    calls[0].sql,
    /UPDATE visit_media SET caption = \?, updated_at = \?/u,
  );
  assert.deepEqual(calls[0].values, ['鮨 course', 'updated', 'media-1']);
  assert.equal(result.caption, '鮨 course');
  assert.equal(result.updatedAt, 'updated');
});

test('the D1 adapter updates and clears a media score without touching its caption', async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return this;
        },
        async first() {
          return { ...row, caption: '鮨 course', score: 4.2 };
        },
      };
    },
  };
  const state = new D1VisitMediaState(database);
  const scored = await state.updateScore('media-1', 4.2, 'updated');
  assert.match(
    calls[0].sql,
    /UPDATE visit_media SET score = \?, updated_at = \?/u,
  );
  assert.deepEqual(calls[0].values, [4.2, 'updated', 'media-1']);
  assert.equal(scored.score, 4.2);
  assert.equal(scored.caption, '鮨 course');
  await state.updateScore('media-1', undefined, 'cleared');
  assert.deepEqual(calls[1].values, [null, 'cleared', 'media-1']);
});

test('the D1 adapter deletes metadata and returns its object identity in one statement', async () => {
  const calls = [];
  const database = {
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return this;
        },
        async first() {
          return row;
        },
      };
    },
  };

  const result = await new D1VisitMediaState(database).delete('media-1');

  assert.match(
    calls[0].sql,
    /DELETE FROM visit_media WHERE id = \?\s+RETURNING/u,
  );
  assert.deepEqual(calls[0].values, ['media-1']);
  assert.equal(result.objectKey, 'visits/visit-1/media-1');
});
