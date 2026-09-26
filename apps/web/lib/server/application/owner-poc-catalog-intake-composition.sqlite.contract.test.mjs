import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createOwnerPocComposition } from './owner-poc-composition.ts';

const root = new URL('../../../migrations/owner-poc/', import.meta.url);

test('production composition wires the repository agent without an external service', () => {
  const database = {
    prepare() {
      throw new Error('construction must not query D1');
    },
  };
  const complete = {
    agentApiKey: 'model-key',
    agentBaseUrl: 'https://model.example/v1',
    agentModel: 'model',
    searchApiKey: 'search-key',
  };
  assert.equal(
    createOwnerPocComposition(database, undefined, complete).providerModes
      .agentResearch,
    'configured',
  );
  for (const key of Object.keys(complete).filter(
    (candidate) => candidate !== 'providerModes',
  )) {
    assert.doesNotThrow(
      () =>
        createOwnerPocComposition(database, undefined, {
          ...complete,
          [key]: undefined,
        }),
      key,
    );
  }
});

test('production owner-poc composition supports manual fields when research is disabled', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    '0001_owner_poc_schema.sql',
    '0002_owner_poc_catalog_seed.sql',
    '0003_copy_legacy_catalog.sql',
    '0004_provider_usage_skus.sql',
    '0005_public_media_display_id.sql',
    '0006_catalog_intake_sessions.sql',
    '0007_nominatim_policy_state.sql',
    '0008_catalog_intake_publication.sql',
    '0009_catalog_intake_research_allowances.sql',
  ]) {
    sqlite.exec(await readFile(new URL(migration, root), 'utf8'));
  }
  const calls = [];
  const ids = ['session-production', 'item-production'];
  const composition = createOwnerPocComposition(toD1(sqlite), undefined, {
    googlePlacesApiKey: 'fixture-google-key',
    providerModes: {
      googlePlaces: 'enabled',
      durableGeocoder: 'enabled',
    },
    clock: { now: () => new Date('2026-09-24T00:00:00.000Z') },
    idSource: { nextId: () => ids.shift() },
    fetch: async (url, init) => {
      const requestUrl =
        url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      calls.push({ url: requestUrl, init });
      if (requestUrl === 'https://places.googleapis.com/v1/places:searchText') {
        return Response.json({
          places: [
            {
              id: 'google-place-1',
              displayName: { text: '鮨テスト' },
              formattedAddress: 'TRANSIENT GOOGLE ADDRESS',
            },
          ],
        });
      }
      if (
        requestUrl === 'https://places.googleapis.com/v1/places/google-place-1'
      ) {
        return Response.json({
          id: 'google-place-1',
          displayName: { text: '鮨テスト' },
          formattedAddress: 'TRANSIENT GOOGLE ADDRESS',
        });
      }
      if (
        requestUrl.startsWith('https://nominatim.openstreetmap.org/search?')
      ) {
        return Response.json([
          {
            osm_type: 'node',
            osm_id: 456,
            display_name: '東京都中央区銀座4丁目1-2, 日本',
            lat: '35.6717',
            lon: '139.7650',
          },
        ]);
      }
      throw new Error(`unexpected endpoint ${requestUrl}`);
    },
  });
  const scope = {
    ownerId: 'owner',
    channel: 'web',
    conversationId: 'conversation',
  };

  const discovered = await composition.catalogIntakeModule.discover(
    { query: '鮨テスト 銀座', requestToken: 'request-1' },
    scope,
  );
  assert.equal(discovered.ok, true);
  const selected = await composition.catalogIntakeModule.select(
    {
      sessionId: discovered.value.sessionId,
      expectedSessionVersion: discovered.value.sessionVersion,
      ordinal: 1,
      ownerFields: { title: '鮨テスト', area: '銀座' },
      tabelog: 'unknown',
      reservation: 'unknown',
      requestResearch: false,
    },
    scope,
  );
  assert.equal(selected.ok, true);
  assert.equal(selected.value.status, 'preview_ready');
  assert.equal(
    selected.value.preview.locationEvidence.provider,
    'nominatim.openstreetmap.org',
  );
  const confirmed = await composition.catalogIntakeModule.confirm(
    {
      sessionId: selected.value.sessionId,
      expectedPreviewVersion: selected.value.preview.previewVersion,
    },
    scope,
  );
  assert.equal(confirmed.ok, true);
  assert.deepEqual(
    confirmed.value.status,
    'committed_verified',
    JSON.stringify(confirmed),
  );
  assert.equal(composition.providerModes.agentResearch, 'disabled');
  assert.equal(calls.length, 4);
  assert.doesNotMatch(
    JSON.stringify(
      sqlite
        .prepare('SELECT terminal_json FROM catalog_intake_terminal_refs')
        .all(),
    ),
    /TRANSIENT GOOGLE ADDRESS/u,
  );
  assert.deepEqual(
    sqlite
      .prepare(
        "SELECT sku, request_count FROM agent_provider_usage_by_sku WHERE provider_id = 'google-places-new' ORDER BY sku",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      { sku: 'places.details.requests', request_count: 2 },
      { sku: 'places.search_text.requests', request_count: 1 },
    ],
  );
  const published = await composition.catalogRead.list('verified_catalog');
  assert.ok(published.some(({ id }) => id === 'item-production'));
});

test('production refuses incomplete Add without creating a hidden review candidate', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    '0001_owner_poc_schema.sql',
    '0002_owner_poc_catalog_seed.sql',
    '0003_copy_legacy_catalog.sql',
    '0004_provider_usage_skus.sql',
    '0005_public_media_display_id.sql',
    '0006_catalog_intake_sessions.sql',
    '0007_nominatim_policy_state.sql',
    '0008_catalog_intake_publication.sql',
    '0009_catalog_intake_research_allowances.sql',
  ]) {
    sqlite.exec(await readFile(new URL(migration, root), 'utf8'));
  }
  const ids = ['session-needs-review', 'item-needs-review'];
  const composition = createOwnerPocComposition(toD1(sqlite), undefined, {
    googlePlacesApiKey: 'fixture-google-key',
    providerModes: {
      googlePlaces: 'enabled',
      durableGeocoder: 'enabled',
    },
    clock: { now: () => new Date('2026-09-25T05:47:09.577Z') },
    idSource: { nextId: () => ids.shift() },
    fetch: async (url) => {
      const requestUrl =
        url instanceof Request ? url.url : url instanceof URL ? url.href : url;
      if (requestUrl === 'https://places.googleapis.com/v1/places:searchText') {
        return Response.json({
          places: [
            {
              id: 'google-place-needs-review',
              displayName: { text: 'Needs review restaurant' },
              formattedAddress: 'TRANSIENT GOOGLE ADDRESS',
            },
          ],
        });
      }
      if (
        requestUrl ===
        'https://places.googleapis.com/v1/places/google-place-needs-review'
      ) {
        return Response.json({
          id: 'google-place-needs-review',
          displayName: { text: 'Needs review restaurant' },
          formattedAddress: 'TRANSIENT GOOGLE ADDRESS',
        });
      }
      if (
        requestUrl.startsWith('https://nominatim.openstreetmap.org/search?')
      ) {
        return Response.json([]);
      }
      throw new Error(`unexpected endpoint ${requestUrl}`);
    },
  });
  const scope = {
    ownerId: 'owner',
    channel: 'web',
    conversationId: 'conversation-needs-review',
  };

  const discovered = await composition.catalogIntakeModule.discover(
    { query: 'Needs review restaurant', requestToken: 'request-needs-review' },
    scope,
  );
  assert.equal(discovered.ok, true);
  const selected = await composition.catalogIntakeModule.select(
    {
      sessionId: discovered.value.sessionId,
      expectedSessionVersion: discovered.value.sessionVersion,
      ordinal: 1,
      ownerFields: {},
      tabelog: 'unknown',
      reservation: 'unknown',
      requestResearch: false,
    },
    scope,
  );
  assert.equal(selected.ok, true);
  assert.equal(selected.value.status, 'preview_ready');
  assert.equal(selected.value.preview.locationEvidence.status, 'unknown');
  const confirmed = await composition.catalogIntakeModule.confirm(
    {
      sessionId: selected.value.sessionId,
      expectedPreviewVersion: selected.value.preview.previewVersion,
    },
    scope,
  );
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.value.status, 'failed_no_write');
  assert.equal(confirmed.value.reason, 'validation');
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM atlas_review_candidates').get().n,
    0,
  );
});

function toD1(database) {
  function prepare(sql) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      async run() {
        const result = database.prepare(sql).run(...values);
        return { success: true, meta: { changes: result.changes } };
      },
      async first() {
        return database.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...values) };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
