import assert from 'node:assert/strict';
import test from 'node:test';

import { D1VisitMediaState } from './d1-visit-media-state.ts';

void test('D1 public media lookup uses only the opaque display ID', async () => {
  const calls = [];
  const row = {
    id: 'internal-media-1',
    display_id: 'pm_opaque_1',
    visit_id: 'visit-1',
    item_id: 'item-1',
    object_key: 'private/object-key',
    original_filename: 'private.jpg',
    content_type: 'image/jpeg',
    byte_size: 3,
    content_sha256: 'private-hash',
    caption: null,
    display_order: 0,
    created_at: 'private-created',
    updated_at: 'private-updated',
  };
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

  const result = await new D1VisitMediaState(database).findByDisplayId(
    row.display_id,
  );

  assert.match(calls[0].sql, /WHERE display_id = \?/u);
  assert.deepEqual(calls[0].values, [row.display_id]);
  assert.equal(result.id, row.id);
  assert.equal(result.displayId, row.display_id);
});
