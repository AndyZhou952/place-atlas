import { toD1 } from '../../../test-support/d1.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import {
  createGoogleRatingReferenceOperationGroup,
  validateGoogleRatingReference,
} from '../../../product/application/catalog/google-rating-reference-operations.ts';
import { createInvocationCoordinator } from '../../../product/application/invocation/invocation-coordinator.ts';
import { D1GoogleRatingReferenceState } from './d1-google-rating-reference-state.ts';
import { D1MutationReceiptState } from './d1-mutation-receipt-state.ts';
import {
  withDisplayedGoogleRatings,
  googleRatingIdentity,
} from '../../../features/atlas/google-rating-display.ts';
import { createPublicReadManifest } from '../public-read/public-read-manifest.ts';

const place = {
  id: 'reference-place',
  kind: 'food',
  title: 'Fixture restaurant',
  area: 'Tokyo',
  address: 'Tokyo, Japan',
  latitude: 35.6,
  longitude: 139.7,
  verificationStatus: 'verified',
  verifiedAt: '2026-10-01',
  description: 'Fixture',
  googlePlaceId: 'ChIJreference123456',
  personalState: 'saved',
  tags: [],
  sources: [],
  reservation: { mode: 'unknown', label: 'Unknown', checkedAt: '2026-10-01' },
  tabelog: {
    score: 3.4,
    url: 'https://tabelog.com/tokyo/A1/A2/12345678/',
    checkedAt: '2026-10-01',
  },
  personalRating: 3.8,
};
const input = {
  itemId: place.id,
  placeId: place.googlePlaceId,
  score: 4.5,
  reviewCount: 123,
  url: 'https://www.google.com/maps/?cid=123',
  observedAt: '2026-10-01T10:00:00.000Z',
};
const invocation = {
  principal: 'owner',
  channel: 'web',
  scopes: ['atlas:owner'],
  requestedAt: '2026-10-02T00:00:00.000Z',
};

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of [
    '0001_owner_poc_schema.sql',
    '0006_catalog_intake_sessions.sql',
    '0012_google_rating_references.sql',
  ])
    sqlite.exec(
      await readFile(
        new URL('../../../migrations/owner-poc/' + name, import.meta.url),
        'utf8',
      ),
    );
  const database = toD1(sqlite);
  const catalog = {
    get: async (id) => (id === place.id ? place : undefined),
    list: async () => [place],
  };
  const state = new D1GoogleRatingReferenceState(database);
  const application = createAtlasApplication(
    createGoogleRatingReferenceOperationGroup(catalog, state, {
      now: () => '2026-10-02T00:00:00.000Z',
    }),
  );
  const coordinator = createInvocationCoordinator({
    application,
    receipts: new D1MutationReceiptState(database),
  });
  return { sqlite, database, catalog, state, application, coordinator };
}

test('reference persists, replays after response loss, and is independent of live updates and other ratings', async () => {
  const { sqlite, state, coordinator } = await setup();
  const envelope = {
    operation: 'catalog.save_google_rating_reference',
    input,
    mutationId: 'save-reference-once',
    invocation,
  };
  const saved = await coordinator.mutate(envelope);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const replay = await coordinator.mutate(envelope);
  assert.equal(replay.value.replayed, true);
  assert.deepEqual(replay.value.result, saved.value.result);
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) n FROM atlas_google_rating_references')
      .get().n,
    1,
  );
  const snapshot = (await state.list())[0];
  assert.equal(snapshot.source, 'google_places_api');
  assert.equal(snapshot.observedAt, input.observedAt);
  assert.equal(snapshot.capturedAt, '2026-10-02T00:00:00.000Z');
  const live = {
    identity: googleRatingIdentity(place),
    status: 'loaded',
    rating: { score: 4.6, url: input.url, checkedAt: snapshot.capturedAt },
  };
  const displayed = withDisplayedGoogleRatings(
    [place],
    { [place.id]: live },
    { [place.id]: snapshot },
  )[0];
  assert.equal(displayed.googleRating.score, 4.6);
  assert.equal(displayed.tabelog.score, 3.4);
  assert.equal(displayed.personalRating, 3.8);
  assert.equal((await state.list())[0].score, 4.5);
  assert.equal(
    withDisplayedGoogleRatings([place], {}, { [place.id]: snapshot })[0]
      .googleRating.score,
    4.5,
  );
  const replaced = await coordinator.mutate({
    ...envelope,
    input: { ...input, score: 4.6 },
    mutationId: 'replace-reference-explicitly',
  });
  assert.equal(replaced.ok, true);
  assert.equal((await state.list())[0].score, 4.6);
  assert.equal((await coordinator.mutate(envelope)).value.result.score, 4.5);
  assert.equal((await state.list())[0].score, 4.6);
  sqlite.close();
});

test('references reject wrong branches, future dates, missing places and mainland China; reads hide changed identities', async () => {
  const { sqlite, catalog, application, state } = await setup();
  for (const invalid of [
    { ...input, placeId: 'ChIJotherbranch123' },
    { ...input, observedAt: '2027-01-01T00:00:00.000Z' },
    { ...input, itemId: 'missing' },
  ])
    assert.equal(
      (
        await application.execute({
          key: 'catalog.save_google_rating_reference',
          input: invalid,
        })
      ).ok,
      false,
    );
  assert.equal((await state.list()).length, 0);
  assert.equal(
    (
      await application.execute({
        key: 'catalog.save_google_rating_reference',
        input,
      })
    ).ok,
    true,
  );
  catalog.get = async () => ({ ...place, address: 'Shanghai, China' });
  catalog.list = async () => [
    { ...place, googlePlaceId: 'ChIJotherbranch123' },
  ];
  assert.equal(
    (
      await application.execute({
        key: 'catalog.save_google_rating_reference',
        input,
      })
    ).ok,
    false,
  );
  assert.deepEqual(
    (
      await application.execute({
        key: 'catalog.google_rating_references',
        input: {},
      })
    ).value,
    [],
  );
  assert.equal(
    withDisplayedGoogleRatings(
      [{ ...place, googlePlaceId: 'ChIJotherbranch123' }],
      {},
      { [place.id]: (await state.list())[0] },
    )[0].googleRating,
    undefined,
  );
  const manifest = createPublicReadManifest();
  assert.equal(
    manifest.authorize('catalog.google_rating_references', 'anonymous').allowed,
    false,
  );
  assert.equal(
    JSON.stringify(manifest.project('catalog.get', place)).includes(
      'capturedAt',
    ),
    false,
  );
  sqlite.close();
});

test('malformed reference values cannot reach storage', () => {
  for (const value of [
    null,
    [],
    { ...input, score: 5.1 },
    { ...input, score: NaN },
    { ...input, reviewCount: -1 },
    { ...input, reviewCount: 1.5 },
    { ...input, url: 'https://example.com/maps/' },
    { ...input, url: 'https://www.google.com.evil.test/' },
    { ...input, url: 'https://user:pass@www.google.com/' },
    { ...input, url: 'http://www.google.com/' },
    { ...input, observedAt: 'not a date' },
  ])
    assert.equal(validateGoogleRatingReference(value).ok, false);
});

test('reference and receipt roll back together when the receipt commit fails', async () => {
  const { sqlite, coordinator, state } = await setup();
  sqlite.exec(
    "CREATE TRIGGER reject_receipt BEFORE INSERT ON atlas_mutation_receipts BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END",
  );
  const result = await coordinator.mutate({
    operation: 'catalog.save_google_rating_reference',
    input,
    mutationId: 'rollback-reference',
    invocation,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(await state.list(), []);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) n FROM atlas_mutation_receipts').get().n,
    0,
  );
  sqlite.close();
});
