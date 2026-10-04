import assert from 'node:assert/strict';
import test from 'node:test';

import { createD1PocCatalogRead } from './d1-poc-catalog-read.ts';

function item(id, overrides = {}) {
  return {
    id,
    kind: 'food',
    title: `Title ${id}`,
    area: 'Tokyo',
    address: 'Tokyo address',
    description: `Description ${id}`,
    latitude: 35.68,
    longitude: 139.76,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-15',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-15',
    },
    personalState: 'candidate',
    tags: [],
    sources: [],
    ...overrides,
  };
}

function row(candidate, overrides = {}) {
  return {
    id: candidate.id,
    kind: candidate.kind,
    verification_status: candidate.verificationStatus,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    payload_json: JSON.stringify(candidate),
    ...overrides,
  };
}

test('the PoC D1 CatalogRead returns valid seed and future intake rows from one table', async () => {
  const seeded = item('repo-seed');
  const added = item('future-add', { verificationStatus: 'needs_review' });
  const database = {
    prepare(sql) {
      assert.match(sql, /FROM agent_catalog_items/u);
      return {
        async all() {
          return {
            results: [
              row(seeded),
              row(added),
              row(item('broken-json'), { payload_json: '{not json' }),
              {
                ...row(item('payload-id')),
                id: 'wrong-row-id',
              },
              {
                ...row(item('incomplete')),
                payload_json: JSON.stringify({ id: 'incomplete' }),
              },
            ],
          };
        },
      };
    },
  };

  const catalog = createD1PocCatalogRead(database);

  assert.deepEqual(await catalog.list('full_merged_catalog'), [seeded, added]);
});

test('the PoC D1 CatalogRead verified profile excludes future records awaiting review', async () => {
  const verified = item('verified');
  const awaitingReview = item('awaiting-review', {
    verificationStatus: 'needs_review',
  });
  const database = {
    prepare() {
      return {
        async all() {
          return {
            results: [verified, awaitingReview].map(row),
          };
        },
      };
    },
  };

  const catalog = createD1PocCatalogRead(database);

  assert.deepEqual(await catalog.list('verified_catalog'), [verified]);
});

test('the PoC D1 CatalogRead looks up one validated payload by its durable row ID', async () => {
  const added = item('future-add', { verificationStatus: 'needs_review' });
  const rows = new Map([
    [added.id, row(added)],
    ['mismatched', { ...row(item('other-id')), id: 'mismatched' }],
  ]);
  const bindings = [];
  const database = {
    prepare(sql) {
      assert.match(sql, /WHERE id = \?/u);
      return {
        bind(id) {
          bindings.push(id);
          return {
            async first() {
              return rows.get(id) ?? null;
            },
          };
        },
      };
    },
  };

  const catalog = createD1PocCatalogRead(database);

  assert.deepEqual(await catalog.get('future-add'), added);
  assert.equal(await catalog.get('mismatched'), undefined);
  assert.equal(await catalog.get('missing'), undefined);
  assert.deepEqual(bindings, ['future-add', 'mismatched', 'missing']);
});

test('the PoC D1 CatalogRead fails closed when indexed status, kind, or coordinates diverge from payload', async () => {
  const valid = item('valid');
  const statusMismatch = item('status-mismatch');
  const kindMismatch = item('kind-mismatch');
  const latitudeMismatch = item('latitude-mismatch');
  const longitudeMismatch = item('longitude-mismatch');
  const database = {
    prepare() {
      return {
        async all() {
          return {
            results: [
              row(valid),
              row(statusMismatch, { verification_status: 'needs_review' }),
              row(kindMismatch, { kind: 'event' }),
              row(latitudeMismatch, { latitude: 35.69 }),
              row(longitudeMismatch, { longitude: 139.77 }),
            ],
          };
        },
      };
    },
  };

  const catalog = createD1PocCatalogRead(database);

  assert.deepEqual(await catalog.list('verified_catalog'), [valid]);
});
