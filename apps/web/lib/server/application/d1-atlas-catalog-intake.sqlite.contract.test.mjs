import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import {
  createCatalogIntakeModule,
  createCatalogIntakeOperationGroup,
} from '../../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { createCatalogRead } from '../../../product/application/catalog/catalog-read.ts';
import { isAtlasItem } from '../../../product/application/catalog/catalog-projection.ts';
import { createNearbyRecommendationOperationGroup } from '../../../product/application/decision/agent-nearby-operation.ts';
import { D1AtlasCatalogIntakePublisher } from './d1-atlas-catalog-intake.ts';
import { D1CatalogIntakeState } from './d1-catalog-intake-state.ts';
import { D1CatalogState } from './d1-catalog-state.ts';
import { D1DestructiveState } from './d1-destructive-state.ts';
import { createPublicReadManifest } from '../public-read/public-read-manifest.ts';
import { loadPublicCatalog } from '../../../features/atlas/public-read-client.ts';

const baseMigration = new URL(
  '../../../migrations/owner-poc/0001_owner_poc_schema.sql',
  import.meta.url,
);
const sessionMigration = new URL(
  '../../../migrations/owner-poc/0006_catalog_intake_sessions.sql',
  import.meta.url,
);
const publicationMigration = new URL(
  '../../../migrations/owner-poc/0008_catalog_intake_publication.sql',
  import.meta.url,
);
const researchAllowanceMigration = new URL(
  '../../../migrations/owner-poc/0009_catalog_intake_research_allowances.sql',
  import.meta.url,
);

test('complete researched profile survives D1 publication and public projection without a new schema', async () => {
  const sqlite = await migratedDatabase();
  const claim = (value) => ({
    value,
    sourceUrl: 'https://example.com/menu',
    observedAt: '2026-09-23T01:59:00.000Z',
  });
  const preview = withDigest({
    ...verifiedPreview(),
    profile: {
      area: claim('Yotsuya'),
      categories: claim(['洋食']),
      signatureDishes: claim(['Oysters']),
      summary: claim('A small restaurant.'),
      openingHours: claim('月・火・水・木・金 17:00 - 05:00 L.O. 04:30'),
      regularClosingDays: claim('火曜日・第3水曜日'),
      officialWebsite: claim('https://example.com/'),
      bookingLink: claim('https://example.com/book'),
      googleRating: claim({ score: 4.2, reviewCount: 10 }),
    },
    reservation: {
      status: 'known',
      mode: 'not_reservable',
      label: 'Reservations not accepted; queue unknown.',
      url: 'https://example.com/menu',
      provenance: 'agent_observed',
      observedAt: '2026-09-23T01:59:00.000Z',
      freshness: 'fresh',
    },
  });
  insertPreviewSession(sqlite, preview, 'b'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'profile-item',
  });
  assert.equal(
    (await publisher.publish(preview, 'b'.repeat(64), 2, 'catalog-r1')).status,
    'committed_verified',
  );
  const stored = JSON.parse(
    sqlite.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  const projected = createPublicReadManifest().project('catalog.get', stored);
  const normalizedProfile = {
    ...preview.profile,
    openingHours: {
      ...preview.profile.openingHours,
      value: '月〜金 17:00–翌05:00 L.O. 04:30',
    },
  };
  assert.deepEqual(projected.tags, ['洋食', 'Oysters']);
  assert.deepEqual(stored.classification.cuisines, [
    { familyId: 'japanese', categoryId: 'japanese.yoshoku' },
  ]);
  assert.deepEqual(projected.classification, stored.classification);
  assert.equal(projected.description, 'A small restaurant.');
  assert.equal(projected.officialUrl, 'https://example.com/');
  assert.deepEqual(projected.openingHours, normalizedProfile.openingHours);
  assert.deepEqual(
    projected.regularClosingDays,
    preview.profile.regularClosingDays,
  );
  assert.deepEqual(stored.openingHours, normalizedProfile.openingHours);
  assert.deepEqual(
    stored.regularClosingDays,
    preview.profile.regularClosingDays,
  );
  assert.equal(projected.googleRating.score, 4.2);
  assert.equal(projected.reservation.mode, 'not_reservable');
  assert.equal(projected.reservation.url, 'https://example.com/book');
  assert.equal(stored.reservation.url, 'https://example.com/book');
  assert.equal(
    stored.intakeEvidence.reservation.url,
    'https://example.com/menu',
  );
  assert.ok(
    projected.sources.some(
      (source) => source.url === 'https://example.com/book',
    ),
  );
  assert.deepEqual(stored.intakeEvidence.profile, normalizedProfile);
  assert.equal(
    preview.profile.openingHours.value,
    '月・火・水・木・金 17:00 - 05:00 L.O. 04:30',
  );
  assert.deepEqual(stored.scheduleCheck, {
    openingHours: 'known',
    regularClosingDays: 'known',
    checkedAt: '2026-09-23T02:00:00.000Z',
  });
  assert.deepEqual(projected.scheduleCheck, stored.scheduleCheck);
  const toreta = structuredClone(stored);
  const toretaUrl = 'https://yoyaku.toreta.in/fixture-kitchen/#/';
  toreta.intakeEvidence.reservation = {
    ...toreta.intakeEvidence.reservation,
    mode: 'reservable',
    label: 'Reservations available',
    url: toretaUrl,
  };
  toreta.intakeEvidence.profile.bookingLink = claim(toretaUrl);
  toreta.reservation = {
    ...toreta.reservation,
    mode: 'advance',
    label: 'Reservations available',
    url: toretaUrl,
  };
  assert.equal(isAtlasItem(toreta), true);
  assert.equal(
    createPublicReadManifest().project('catalog.get', toreta).reservation.url,
    toretaUrl,
  );
  const invalidToreta = structuredClone(toreta);
  invalidToreta.intakeEvidence.reservation.url = `${toretaUrl}untrusted`;
  assert.equal(isAtlasItem(invalidToreta), false);
  const catalog = createCatalogRead(new D1CatalogState(toD1(sqlite)), []);
  assert.equal((await catalog.list('verified_catalog'))[0]?.id, 'profile-item');
  const browserItems = await loadPublicCatalog({
    async request(url) {
      return url === '/api/items'
        ? Response.json([projected])
        : Response.json({ favorite: false, effectiveVisited: false });
    },
  });
  assert.equal(browserItems[0].googleRating.score, 4.2);
  assert.equal(browserItems[0].reservation.mode, 'unavailable');
  assert.deepEqual(browserItems[0].tags, ['洋食', 'Oysters']);
});

test('Owner schedule corrections survive publication and the browser over earlier model facts', async () => {
  const sqlite = await migratedDatabase();
  const preview = withDigest({
    ...verifiedPreview(),
    ownerFields: {
      ...verifiedPreview().ownerFields,
      openingHours: {
        value: '月・火 11:00 - 14:00\n17:00 - 21:00',
        sourceUrl: 'https://example.com/current-hours',
      },
      regularClosingDays: {
        value: '水曜日',
        sourceUrl: 'https://example.com/current-hours',
      },
    },
    profile: {
      openingHours: {
        value: '毎日 08:00 - 22:00',
        sourceUrl: 'https://example.com/old',
        observedAt: '2026-09-22T00:00:00.000Z',
      },
    },
  });
  insertPreviewSession(sqlite, preview, 'b'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'schedule-owner-item',
  });
  assert.equal(
    (await publisher.publish(preview, 'b'.repeat(64), 2, 'catalog-r1')).status,
    'committed_verified',
  );
  const stored = JSON.parse(
    sqlite.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  assert.equal(isAtlasItem(stored), true);
  const projected = createPublicReadManifest().project('catalog.get', stored);
  assert.equal(
    projected.openingHours.value,
    '月・火 11:00–14:00 / 17:00–21:00',
  );
  assert.equal(projected.regularClosingDays.value, '水曜日');
  const browser = await loadPublicCatalog({
    request: async (url) =>
      url === '/api/items'
        ? Response.json([projected])
        : Response.json({
            itemId: stored.id,
            favorite: false,
            manualVisited: false,
            effectiveVisited: false,
          }),
  });
  assert.deepEqual(browser[0].openingHours, stored.openingHours);
  assert.deepEqual(browser[0].scheduleCheck, stored.scheduleCheck);
  assert.deepEqual(stored.intakeEvidence.ownerFields, {
    ...preview.ownerFields,
    openingHours: {
      ...preview.ownerFields.openingHours,
      value: '月・火 11:00–14:00 / 17:00–21:00',
    },
  });
  assert.deepEqual(stored.intakeEvidence.profile.openingHours, {
    ...preview.profile.openingHours,
    value: '毎日 08:00–22:00',
  });
  sqlite.close();
});

test('unavailable schedules are explicitly recorded without fabricated hours', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  insertPreviewSession(sqlite, preview, 'b'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'schedule-unavailable-item',
  });
  assert.equal(
    (await publisher.publish(preview, 'b'.repeat(64), 2, 'catalog-r1')).status,
    'committed_verified',
  );
  const stored = JSON.parse(
    sqlite.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  assert.deepEqual(stored.scheduleCheck, {
    openingHours: 'unavailable',
    regularClosingDays: 'unavailable',
    checkedAt: '2026-09-23T02:00:00.000Z',
  });
  assert.equal(stored.openingHours, undefined);
  assert.equal(stored.regularClosingDays, undefined);
  assert.deepEqual(
    createPublicReadManifest().project('catalog.get', stored).scheduleCheck,
    stored.scheduleCheck,
  );
  sqlite.close();
});

test('owner-completed profile publishes with explicit owner provenance and compact tags', async () => {
  const sqlite = await migratedDatabase();
  const base = verifiedPreview();
  const preview = withDigest({
    ...base,
    ownerFields: {
      ...base.ownerFields,
      title: 'SHAKE SHACK Shinjuku Southern Terrace',
      categories: ['汉堡', '美式快餐'],
      signatureDishes: ['ShackBurger', 'Crinkle-cut fries', 'Frozen custard'],
      summary: '新宿南口的汉堡店，提供 ShackBurger 和薯条。',
    },
  });
  insertPreviewSession(sqlite, preview, '7'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'owner-completed-shake-shack',
  });
  assert.equal(
    (await publisher.publish(preview, '7'.repeat(64), 2, 'catalog-r1')).status,
    'committed_verified',
  );
  const stored = JSON.parse(
    sqlite.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  assert.equal(stored.description, preview.ownerFields.summary);
  assert.deepEqual(stored.tags, [
    '汉堡',
    '美式快餐',
    'ShackBurger',
    'Crinkle-cut fries',
  ]);
  assert.deepEqual(stored.intakeEvidence.ownerFields, preview.ownerFields);
  const catalog = createCatalogRead(new D1CatalogState(toD1(sqlite)), []);
  const visible = await catalog.list('verified_catalog');
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'owner-completed-shake-shack');
  const projected = createPublicReadManifest().project(
    'catalog.get',
    visible[0],
  );
  assert.equal(projected.title, 'SHAKE SHACK Shinjuku Southern Terrace');
  assert.deepEqual(projected.tags, stored.tags);
});

test('D1 Atlas Catalog publish atomically commits a verified item, identity, snapshots, receipt, and terminal session', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  insertPreviewSession(sqlite, preview, 'a'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'atlas-intake-item-1',
  });

  const result = await publisher.publish(
    preview,
    'a'.repeat(64),
    2,
    'catalog-r1',
  );

  assert.deepEqual(result, {
    status: 'committed_verified',
    itemId: 'atlas-intake-item-1',
    receiptRef: 'a'.repeat(64),
    replayed: false,
  });
  assert.equal(count(sqlite, 'atlas_place_identities'), 1);
  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(count(sqlite, 'atlas_item_location_snapshots'), 1);
  assert.equal(count(sqlite, 'atlas_item_tabelog_snapshots'), 1);
  assert.equal(count(sqlite, 'atlas_item_reservation_snapshots'), 1);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 1);
  assert.equal(count(sqlite, 'catalog_intake_sessions'), 0);
  assert.equal(count(sqlite, 'catalog_intake_terminal_refs'), 1);
  const item = JSON.parse(
    sqlite.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  assert.equal(item.verificationStatus, 'verified');
  assert.equal(item.title, '鮨 さいとう');
  assert.equal(item.address, '東京都港区六本木1-4-5');
  assert.equal(item.latitude, 35.6654);
  assert.equal(item.longitude, 139.7298);
  assert.deepEqual(item.intakeEvidence.candidateIdentity, {
    providerNamespace: 'google-places',
    placeId: 'place-1',
  });
  assert.deepEqual(
    item.intakeEvidence.locationEvidence,
    preview.locationEvidence,
  );
  assert.deepEqual(item.intakeEvidence.tabelog, preview.tabelog);
  assert.deepEqual(item.intakeEvidence.reservation, preview.reservation);
  assert.equal(Object.hasOwn(item, 'tabelog'), false);
  assert.equal(Object.hasOwn(item.reservation, 'checkedAt'), false);
  assert.deepEqual(item.sources, []);
});

test('D1 Atlas Catalog publish refreshes a stale catalog revision as a new preview with zero Catalog writes', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  insertPreviewSession(sqlite, preview, 'c'.repeat(64));
  const confirmDigest = 'd'.repeat(64);
  const beforeRace = JSON.parse(
    sqlite
      .prepare(
        'SELECT session_json FROM catalog_intake_sessions WHERE session_id = ?',
      )
      .get(preview.sessionId).session_json,
  );
  beforeRace.researchPhaseDigests = {
    initial: 'a'.repeat(64),
    confirm: confirmDigest,
  };
  beforeRace.researchPhaseApplications = {
    confirm: {
      queryOrUrlsDigest: confirmDigest,
      appliedPreviewVersion: preview.previewVersion,
    },
  };
  sqlite
    .prepare(
      'UPDATE catalog_intake_sessions SET session_json = ? WHERE session_id = ?',
    )
    .run(JSON.stringify(beforeRace), preview.sessionId);
  sqlite
    .prepare(
      'UPDATE atlas_catalog_revision SET revision_number = 2 WHERE singleton = 1',
    )
    .run();
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'must-not-be-published',
  });

  const result = await publisher.publish(
    preview,
    'c'.repeat(64),
    2,
    'catalog-r1',
  );

  assert.equal(result.status, 'conflict');
  assert.equal(result.newPreview.previewVersion, 2);
  assert.equal(result.newPreview.catalogRevision, 'catalog-r2');
  assert.notEqual(result.newPreview.evidenceDigest, preview.evidenceDigest);
  assert.equal(count(sqlite, 'atlas_place_identities'), 0);
  assert.equal(count(sqlite, 'atlas_items'), 0);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0);
  const stored = JSON.parse(
    sqlite
      .prepare(
        'SELECT session_json FROM catalog_intake_sessions WHERE session_id = ?',
      )
      .get('session-1').session_json,
  );
  assert.equal(stored.sessionVersion, 3);
  assert.deepEqual(stored.preview, result.newPreview);
  assert.deepEqual(stored.researchPhaseApplications, {
    confirm: {
      queryOrUrlsDigest: confirmDigest,
      appliedPreviewVersion: result.newPreview.previewVersion,
    },
  });
  assert.equal('researchPhaseApplications' in result.newPreview, false);
});

test('D1 Atlas Catalog commits incomplete durable evidence as owner-only needs review', async () => {
  const sqlite = await migratedDatabase();
  const preview = withDigest({
    ...verifiedPreview(),
    ownerFields: { title: '鮨 さいとう' },
    locationEvidence: { status: 'unknown' },
    unknownFields: ['address', 'coordinates'],
    warnings: [
      {
        code: 'needs_review',
        message: 'Durable location evidence needs review.',
      },
    ],
  });
  insertPreviewSession(sqlite, preview, 'e'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'atlas-needs-review-1',
  });

  assert.deepEqual(
    await publisher.publish(preview, 'e'.repeat(64), 2, 'catalog-r1'),
    {
      status: 'committed_needs_review',
      itemId: 'atlas-needs-review-1',
      receiptRef: 'e'.repeat(64),
      replayed: false,
    },
  );
  assert.equal(count(sqlite, 'atlas_items'), 0);
  assert.equal(count(sqlite, 'atlas_review_candidates'), 1);
  const candidate = JSON.parse(
    sqlite.prepare('SELECT payload_json FROM atlas_review_candidates').get()
      .payload_json,
  );
  assert.equal(candidate.recordType, 'review_candidate');
  assert.equal(candidate.verificationStatus, 'needs_review');
  assert.equal(candidate.title, '鮨 さいとう');
  for (const fabricated of ['address', 'latitude', 'longitude', 'verifiedAt']) {
    assert.equal(Object.hasOwn(candidate, fabricated), false, fabricated);
  }
  assert.deepEqual(candidate.reviewEvidence.locationEvidence, {
    status: 'unknown',
  });
  assert.deepEqual(candidate.reviewEvidence.tabelog, preview.tabelog);
  assert.deepEqual(candidate.reviewEvidence.reservation, preview.reservation);
  const catalog = createCatalogRead(new D1CatalogState(toD1(sqlite)), []);
  assert.deepEqual(await catalog.list('verified_catalog'), []);
  assert.deepEqual(
    (await catalog.list('full_merged_catalog')).map(
      ({ id, recordType, verificationStatus }) => ({
        id,
        recordType,
        verificationStatus,
      }),
    ),
    [
      {
        id: 'atlas-needs-review-1',
        recordType: 'review_candidate',
        verificationStatus: 'needs_review',
      },
    ],
  );
});

test('a newly researched preview promotes an existing review candidate into the public map exactly once', async () => {
  const sqlite = await migratedDatabase();
  const incomplete = withDigest({
    ...verifiedPreview(),
    locationEvidence: { status: 'unknown' },
    unknownFields: ['coordinates'],
  });
  insertPreviewSession(sqlite, incomplete, 'e'.repeat(64));
  let attempt = 0;
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => `promotion-attempt-${++attempt}`,
  });
  const first = await publisher.publish(
    incomplete,
    'e'.repeat(64),
    2,
    'catalog-r1',
  );
  assert.equal(first.status, 'committed_needs_review');
  const complete = withDigest({
    ...verifiedPreview(),
    sessionId: 'promotion-session',
    catalogRevision: 'catalog-r2',
    locationEvidence: {
      status: 'known',
      provenance: 'agent_observed',
      normalizedAddress: 'Tokyo fixture address',
      latitude: 35.6,
      longitude: 139.7,
      sourceUrl: 'https://example.com/restaurant',
      observedAt: '2026-09-23T01:59:00.000Z',
    },
  });
  insertPreviewSession(sqlite, complete, 'd'.repeat(64));
  const committed = await publisher.publish(
    complete,
    'd'.repeat(64),
    2,
    'catalog-r2',
  );
  assert.deepEqual(committed, {
    status: 'committed_verified',
    itemId: first.itemId,
    receiptRef: 'd'.repeat(64),
    replayed: false,
  });
  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(count(sqlite, 'atlas_review_candidates'), 0);
  assert.equal(count(sqlite, 'atlas_place_identities'), 1);
  const stored = JSON.parse(
    sqlite.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  assert.equal(stored.id, first.itemId);
  assert.deepEqual(
    stored.intakeEvidence.locationEvidence,
    complete.locationEvidence,
  );
  assert.equal(
    sqlite
      .prepare('SELECT created_by_mutation_key FROM atlas_place_identities')
      .get().created_by_mutation_key,
    'e'.repeat(64),
  );
  assert.equal(
    sqlite.prepare('SELECT revision_number FROM atlas_catalog_revision').get()
      .revision_number,
    3,
  );
  for (const table of [
    'atlas_item_location_snapshots',
    'atlas_item_tabelog_snapshots',
    'atlas_item_reservation_snapshots',
  ]) {
    assert.equal(count(sqlite, table), 1, table);
  }
  const catalog = createCatalogRead(new D1CatalogState(toD1(sqlite)), []);
  assert.deepEqual(
    (await catalog.list('verified_catalog')).map((item) => item.id),
    [first.itemId],
  );
  const invalidProfile = {
    ...stored,
    intakeEvidence: {
      ...stored.intakeEvidence,
      profile: { categories: { value: ['Udon'] } },
    },
  };
  sqlite
    .prepare('UPDATE atlas_items SET payload_json = ?')
    .run(JSON.stringify(invalidProfile));
  assert.deepEqual(
    await catalog.list('verified_catalog'),
    [],
    'new profile fields still require valid source evidence',
  );
  sqlite
    .prepare('UPDATE atlas_items SET payload_json = ?')
    .run(JSON.stringify(stored));
  assert.deepEqual(
    await publisher.publish(complete, 'd'.repeat(64), 2, 'catalog-r2'),
    { ...committed, replayed: true },
  );
});

test('a revision race during candidate promotion preserves the candidate and its existing snapshots', async () => {
  const sqlite = await migratedDatabase();
  const incomplete = withDigest({
    ...verifiedPreview(),
    locationEvidence: { status: 'unknown' },
  });
  insertPreviewSession(sqlite, incomplete, 'e'.repeat(64));
  await new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'original-candidate',
  }).publish(incomplete, 'e'.repeat(64), 2, 'catalog-r1');
  const priorSnapshots = sqlite
    .prepare('SELECT * FROM atlas_item_tabelog_snapshots')
    .all();
  const complete = withDigest({
    ...verifiedPreview(),
    sessionId: 'racing-promotion',
    catalogRevision: 'catalog-r2',
  });
  insertPreviewSession(sqlite, complete, 'd'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(
    toD1(sqlite, {
      beforeFirstBatchOnce() {
        sqlite
          .prepare('UPDATE atlas_catalog_revision SET revision_number = 3')
          .run();
      },
    }),
    {
      now: () => new Date('2026-09-23T02:00:00.000Z'),
      nextId: () => 'racing-attempt',
    },
  );
  assert.equal(
    (await publisher.publish(complete, 'd'.repeat(64), 2, 'catalog-r2')).status,
    'conflict',
  );
  assert.equal(count(sqlite, 'atlas_items'), 0);
  assert.equal(count(sqlite, 'atlas_review_candidates'), 1);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 1);
  assert.deepEqual(
    sqlite.prepare('SELECT * FROM atlas_item_tabelog_snapshots').all(),
    priorSnapshots,
  );
});

test('D1 Atlas Catalog reuses a strong identity and replays the same 180-day receipt after response loss', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  const existingItem = {
    id: 'existing-item',
    kind: 'food',
    title: 'Existing',
    area: '六本木',
    address: '東京都港区',
    description: 'Existing Atlas item.',
    latitude: 35.6,
    longitude: 139.7,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-01T00:00:00.000Z',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-01T00:00:00.000Z',
    },
    personalState: 'saved',
    tags: [],
    sources: [],
  };
  sqlite
    .prepare(
      'INSERT INTO atlas_items ' +
        '(id, payload_json, verification_status, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      existingItem.id,
      JSON.stringify(existingItem),
      'verified',
      existingItem.verifiedAt,
      existingItem.verifiedAt,
    );
  sqlite
    .prepare(
      'INSERT INTO atlas_place_identities ' +
        '(provider_namespace, place_id, item_id, created_by_mutation_key, created_at_ms) ' +
        'VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      'google-places',
      'place-1',
      existingItem.id,
      'f'.repeat(64),
      Date.parse(existingItem.verifiedAt),
    );
  insertPreviewSession(sqlite, preview, '1'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'must-not-create',
  });
  const mutationKey = '1'.repeat(64);

  const committed = await publisher.publish(
    preview,
    mutationKey,
    2,
    'catalog-r1',
  );
  assert.deepEqual(committed, {
    status: 'reused_existing',
    itemId: existingItem.id,
    receiptRef: mutationKey,
    replayed: false,
  });
  assert.deepEqual(
    await publisher.publish(preview, mutationKey, 2, 'catalog-r1'),
    { ...committed, replayed: true },
  );
  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(count(sqlite, 'atlas_place_identities'), 1);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 1);
  const receipt = sqlite
    .prepare(
      'SELECT committed_at_ms, retain_until_ms ' +
        'FROM catalog_intake_publish_receipts WHERE mutation_key = ?',
    )
    .get(mutationKey);
  assert.equal(
    receipt.retain_until_ms - receipt.committed_at_ms,
    180 * 24 * 60 * 60 * 1000,
  );
});

test('D1 Atlas Catalog replays receipts before 180 days and fails closed at the exact retention boundary', async () => {
  let now = new Date('2026-09-23T02:00:00.000Z');
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  insertPreviewSession(sqlite, preview, '6'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => now,
    nextId: () => 'atlas-retention-1',
  });
  const mutationKey = '6'.repeat(64);
  const committed = await publisher.publish(
    preview,
    mutationKey,
    2,
    'catalog-r1',
  );

  now = new Date(
    Date.parse('2026-09-23T02:00:00.000Z') + 180 * 24 * 60 * 60 * 1000 - 1,
  );
  assert.deepEqual(
    await publisher.publish(preview, mutationKey, 2, 'catalog-r1'),
    { ...committed, replayed: true },
  );

  now = new Date(
    Date.parse('2026-09-23T02:00:00.000Z') + 180 * 24 * 60 * 60 * 1000,
  );
  assert.equal(
    (await publisher.publish(preview, mutationKey, 2, 'catalog-r1')).status,
    'conflict',
  );
  assert.equal(count(sqlite, 'atlas_items'), 1);
  await new D1CatalogIntakeState(toD1(sqlite)).cleanup(now);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0);
});

test('D1 Atlas Catalog rolls back every publication row when the transaction fails', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  insertPreviewSession(sqlite, preview, '2'.repeat(64));
  sqlite
    .prepare(
      'INSERT INTO atlas_items ' +
        '(id, payload_json, verification_status, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      'colliding-item',
      JSON.stringify({ id: 'preexisting-collision' }),
      'needs_review',
      '2026-09-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
    );
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'colliding-item',
  });

  assert.deepEqual(
    await publisher.publish(preview, '2'.repeat(64), 2, 'catalog-r1'),
    { status: 'failed_no_write', reason: 'transaction' },
  );
  assert.equal(count(sqlite, 'atlas_place_identities'), 0);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0);
  assert.equal(count(sqlite, 'catalog_intake_terminal_refs'), 0);
  assert.equal(count(sqlite, 'catalog_intake_sessions'), 1);
});

test('D1 Atlas Catalog recovers the committed receipt when the transaction acknowledgement is lost', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  insertPreviewSession(sqlite, preview, '7'.repeat(64));
  const database = toD1(sqlite, { throwAfterCommitOnce: true });
  const publisher = new D1AtlasCatalogIntakePublisher(database, {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'atlas-ack-loss-1',
  });
  const mutationKey = '7'.repeat(64);

  assert.deepEqual(
    await publisher.publish(preview, mutationKey, 2, 'catalog-r1'),
    {
      status: 'committed_verified',
      itemId: 'atlas-ack-loss-1',
      receiptRef: mutationKey,
      replayed: true,
    },
  );
  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(count(sqlite, 'atlas_review_candidates'), 0);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 1);
  assert.equal(
    sqlite
      .prepare(
        'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1',
      )
      .get().revision_number,
    2,
  );
});

test('D1 Atlas Catalog never reports failed_no_write when both the acknowledgement and recovery receipt read are lost', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  const mutationKey = '4'.repeat(64);
  insertPreviewSession(sqlite, preview, mutationKey);
  const publisher = new D1AtlasCatalogIntakePublisher(
    toD1(sqlite, {
      throwAfterCommitOnce: true,
      failRecoveryReceiptReadOnce: true,
    }),
    {
      now: () => new Date('2026-09-23T02:00:00.000Z'),
      nextId: () => 'atlas-ambiguous-ack-1',
    },
  );

  const result = await publisher.publish(preview, mutationKey, 2, 'catalog-r1');

  assert.equal(result.status, 'conflict');
  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 1);
});

test('D1 Atlas Catalog serializes concurrent confirms for one mutation into one commit and one replay', async () => {
  const sqlite = await migratedDatabase();
  const preview = withDigest({
    ...verifiedPreview(),
    ownerFields: { title: '鮨 さいとう' },
    locationEvidence: { status: 'unknown' },
    tabelog: { status: 'unknown' },
    reservation: { status: 'unknown' },
    unknownFields: ['address', 'coordinates', 'tabelog', 'reservation'],
  });
  insertPreviewSession(sqlite, preview, '8'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(
    toD1(sqlite, {
      serializeBatch: true,
      barrierInitialReceiptReads: 2,
      barrierInitialRevisionReads: 2,
    }),
    {
      now: () => new Date('2026-09-23T02:00:00.000Z'),
      nextId: (() => {
        let id = 0;
        return () => `atlas-concurrent-${++id}`;
      })(),
    },
  );
  const mutationKey = '8'.repeat(64);

  const results = await Promise.all([
    publisher.publish(preview, mutationKey, 2, 'catalog-r1'),
    publisher.publish(preview, mutationKey, 2, 'catalog-r1'),
  ]);

  assert.deepEqual(
    results
      .map(({ status, replayed }) => ({ status, replayed }))
      .sort((a, b) => Number(a.replayed) - Number(b.replayed)),
    [
      { status: 'committed_needs_review', replayed: false },
      { status: 'committed_needs_review', replayed: true },
    ],
  );
  assert.equal(count(sqlite, 'atlas_items'), 0);
  assert.equal(count(sqlite, 'atlas_review_candidates'), 1);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 1);
  assert.equal(
    sqlite
      .prepare(
        'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1',
      )
      .get().revision_number,
    2,
  );
});

test('D1 Atlas Catalog rebuilds a revision-raced second session before reusing the same strong identity', async () => {
  const sqlite = await migratedDatabase();
  const first = verifiedPreview();
  const second = withDigest({ ...verifiedPreview(), sessionId: 'session-2' });
  const firstKey = '9'.repeat(64);
  const secondKey = 'a'.repeat(64);
  insertPreviewSession(sqlite, first, firstKey);
  insertPreviewSession(sqlite, second, secondKey);
  let nextId = 0;
  const publisher = new D1AtlasCatalogIntakePublisher(
    toD1(sqlite, {
      serializeBatch: true,
      barrierInitialReceiptReads: 2,
      barrierInitialRevisionReads: 2,
    }),
    {
      now: () => new Date('2026-09-23T02:00:00.000Z'),
      nextId: () => `atlas-identity-race-${++nextId}`,
    },
  );

  const outcomes = await Promise.all([
    publisher.publish(first, firstKey, 2, 'catalog-r1'),
    publisher.publish(second, secondKey, 2, 'catalog-r1'),
  ]);
  // Either concurrent writer may win; assert the resulting serialization.
  const committed = outcomes.find(
    ({ status }) => status === 'committed_verified',
  );
  const raced = outcomes.find(({ status }) => status === 'conflict');

  assert.ok(committed);
  assert.ok(raced);
  assert.equal(committed.status, 'committed_verified');
  assert.equal(raced.status, 'conflict');
  assert.equal(raced.newPreview.catalogRevision, 'catalog-r2');
  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(count(sqlite, 'atlas_place_identities'), 1);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 1);

  const retryKey = 'b'.repeat(64);
  claimPreviewSession(sqlite, raced.newPreview, retryKey, 4);
  assert.deepEqual(
    await publisher.publish(raced.newPreview, retryKey, 4, 'catalog-r2'),
    {
      status: 'reused_existing',
      itemId: committed.itemId,
      receiptRef: retryKey,
      replayed: false,
    },
  );
  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 2);
  assert.equal(
    sqlite
      .prepare(
        'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1',
      )
      .get().revision_number,
    2,
  );
});

test('D1 Atlas Catalog rejects invalid or stale publication attempts with zero writes', async () => {
  for (const scenario of ['invalid-key', 'stale-version', 'missing-session']) {
    const sqlite = await migratedDatabase();
    const preview = verifiedPreview();
    insertPreviewSession(sqlite, preview, '3'.repeat(64));
    if (scenario === 'missing-session') {
      sqlite
        .prepare('DELETE FROM catalog_intake_sessions WHERE session_id = ?')
        .run(preview.sessionId);
    }
    const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
      now: () => new Date('2026-09-23T02:00:00.000Z'),
      nextId: () => 'must-not-create',
    });
    const result = await publisher.publish(
      preview,
      scenario === 'invalid-key' ? 'client-key' : '3'.repeat(64),
      scenario === 'stale-version' ? 1 : 2,
      'catalog-r1',
    );

    assert.equal(
      result.status,
      scenario === 'invalid-key' ? 'failed_no_write' : 'conflict',
    );
    assert.equal(count(sqlite, 'atlas_place_identities'), 0);
    assert.equal(count(sqlite, 'atlas_items'), 0);
    assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0);
    assert.equal(count(sqlite, 'catalog_intake_terminal_refs'), 0);
  }
});

test('D1 Atlas Catalog rejects a mutation key that does not match the scope-bound server session commitment', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  insertPreviewSession(sqlite, preview, 'a'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'must-not-create',
  });

  const result = await publisher.publish(
    preview,
    'b'.repeat(64),
    2,
    'catalog-r1',
  );

  assert.equal(result.status, 'conflict');
  assert.equal(count(sqlite, 'atlas_place_identities'), 0);
  assert.equal(count(sqlite, 'atlas_items'), 0);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0);
});

test('D1 Atlas Catalog rechecks expiry inside the publication transaction and writes nothing at the exact TTL boundary', async () => {
  const sqlite = await migratedDatabase();
  const preview = withDigest({
    ...verifiedPreview(),
    expiresAt: '2026-09-23T02:00:00.000Z',
  });
  insertPreviewSession(sqlite, preview, '4'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'must-not-create',
  });

  const result = await publisher.publish(
    preview,
    '4'.repeat(64),
    2,
    'catalog-r1',
  );

  assert.equal(result.status, 'conflict');
  assert.equal(count(sqlite, 'atlas_place_identities'), 0);
  assert.equal(count(sqlite, 'atlas_items'), 0);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0);
  assert.equal(count(sqlite, 'catalog_intake_terminal_refs'), 0);
});

test('D1 Atlas Catalog does not renew an expired session when the catalog revision also drifted', async () => {
  const sqlite = await migratedDatabase();
  const preview = withDigest({
    ...verifiedPreview(),
    expiresAt: '2026-09-23T02:00:00.000Z',
  });
  const mutationKey = 'd'.repeat(64);
  insertPreviewSession(sqlite, preview, mutationKey);
  sqlite
    .prepare(
      'UPDATE atlas_catalog_revision SET revision_number = 2 WHERE singleton = 1',
    )
    .run();
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'must-not-create',
  });

  const result = await publisher.publish(preview, mutationKey, 2, 'catalog-r1');

  assert.deepEqual(result, { status: 'conflict', newPreview: preview });
  const stored = sqlite
    .prepare(
      'SELECT session_version, expires_at_ms, session_json FROM catalog_intake_sessions WHERE session_id = ?',
    )
    .get(preview.sessionId);
  assert.equal(stored.session_version, 2);
  assert.equal(stored.expires_at_ms, Date.parse(preview.expiresAt));
  assert.deepEqual(JSON.parse(stored.session_json).preview, preview);
  assert.equal(count(sqlite, 'atlas_place_identities'), 0);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0);
});

test('D1 Atlas Catalog rereads the full authoritative preview and rejects changed fields even when a stale digest is reused', async () => {
  const sqlite = await migratedDatabase();
  const authoritative = verifiedPreview();
  insertPreviewSession(sqlite, authoritative, '5'.repeat(64));
  const tampered = {
    ...authoritative,
    ownerFields: {
      ...authoritative.ownerFields,
      title: 'Changed without recomputing the digest',
    },
  };
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'must-not-create',
  });

  const result = await publisher.publish(
    tampered,
    '5'.repeat(64),
    2,
    'catalog-r1',
  );

  assert.deepEqual(result, {
    status: 'failed_no_write',
    reason: 'validation',
  });
  assert.equal(count(sqlite, 'atlas_place_identities'), 0);
  assert.equal(count(sqlite, 'atlas_items'), 0);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0);
});

test('D1 Atlas Catalog rejects an authoritative stored preview whose body changed without a recomputed digest', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  const mutationKey = '0'.repeat(64);
  insertPreviewSession(sqlite, preview, mutationKey);
  const tampered = {
    ...preview,
    ownerFields: { ...preview.ownerFields, title: 'Tampered stored title' },
  };
  sqlite
    .prepare(
      "UPDATE catalog_intake_sessions SET session_json = json_set(session_json, '$.preview', json(?)) WHERE session_id = ?",
    )
    .run(JSON.stringify(tampered), preview.sessionId);
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'must-not-create',
  });

  assert.deepEqual(
    await publisher.publish(tampered, mutationKey, 2, 'catalog-r1'),
    { status: 'failed_no_write', reason: 'validation' },
  );
  assert.equal(count(sqlite, 'atlas_place_identities'), 0);
  assert.equal(count(sqlite, 'atlas_items'), 0);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0);
});

test('D1 Catalog save atomically advances the revision observed by intake publish', async () => {
  const sqlite = await migratedDatabase();
  const state = new D1CatalogState(toD1(sqlite));
  const preview = verifiedPreview();
  const item = {
    id: 'ordinary-save-1',
    kind: 'food',
    title: 'Ordinary save',
    area: 'Tokyo',
    address: 'Tokyo address',
    description: 'Saved outside intake.',
    latitude: 35.68,
    longitude: 139.76,
    verificationStatus: 'needs_review',
    verifiedAt: '2026-09-23T02:00:00.000Z',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-23T02:00:00.000Z',
    },
    personalState: 'saved',
    tags: [],
    sources: [],
  };

  await state.saveDynamicItem(item, '2026-09-23T02:00:00.000Z');

  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(
    sqlite
      .prepare(
        'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1',
      )
      .get().revision_number,
    2,
  );
  insertPreviewSession(sqlite, preview, 'f'.repeat(64));
  const publisher = new D1AtlasCatalogIntakePublisher(toD1(sqlite), {
    now: () => new Date('2026-09-23T02:00:01.000Z'),
    nextId: () => 'must-not-create',
  });
  const result = await publisher.publish(
    preview,
    'f'.repeat(64),
    2,
    'catalog-r1',
  );
  assert.equal(result.status, 'conflict');
  assert.equal(result.newPreview.catalogRevision, 'catalog-r2');
});

test('D1 Atlas Catalog rebuilds instead of publishing across save, update, and delete revision races', async () => {
  for (const scenario of ['save', 'update', 'delete']) {
    const sqlite = await migratedDatabase();
    const preview = verifiedPreview();
    const mutationKey =
      scenario === 'save'
        ? 'c'.repeat(64)
        : scenario === 'update'
          ? 'd'.repeat(64)
          : 'e'.repeat(64);
    insertPreviewSession(sqlite, preview, mutationKey);
    const raceItem = {
      id: `race-${scenario}`,
      kind: 'food',
      title: 'Revision race item',
      area: 'Tokyo',
      address: 'Tokyo',
      description: 'Concurrent Catalog mutation.',
      latitude: 35.68,
      longitude: 139.76,
      verificationStatus: 'needs_review',
      verifiedAt: '2026-09-23T02:00:00.000Z',
      reservation: {
        mode: 'unknown',
        label: 'Unknown',
        checkedAt: '2026-09-23T02:00:00.000Z',
      },
      personalState: 'saved',
      tags: [],
      sources: [],
    };
    if (scenario !== 'save') {
      sqlite
        .prepare(
          'INSERT INTO atlas_items ' +
            '(id, payload_json, verification_status, created_at, updated_at) ' +
            'VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          raceItem.id,
          JSON.stringify(raceItem),
          raceItem.verificationStatus,
          raceItem.verifiedAt,
          raceItem.verifiedAt,
        );
    }
    const mutateCatalog = async () => {
      if (scenario === 'save') {
        await new D1CatalogState(toD1(sqlite)).saveDynamicItem(
          raceItem,
          raceItem.verifiedAt,
        );
      } else if (scenario === 'update') {
        await new D1CatalogState(toD1(sqlite)).saveOverride({
          itemId: raceItem.id,
          title: 'Updated during confirm',
          description: raceItem.description,
          personalState: 'saved',
          updatedAt: '2026-09-23T02:00:01.000Z',
        });
      } else {
        await new D1DestructiveState(toD1(sqlite)).commitItemDeletion(
          raceItem.id,
          '2026-09-23T02:00:01.000Z',
        );
      }
    };
    const publisher = new D1AtlasCatalogIntakePublisher(
      toD1(sqlite, { beforeFirstBatchOnce: mutateCatalog }),
      {
        now: () => new Date('2026-09-23T02:00:02.000Z'),
        nextId: () => `must-not-publish-${scenario}`,
      },
    );

    const result = await publisher.publish(
      preview,
      mutationKey,
      2,
      'catalog-r1',
    );

    assert.equal(result.status, 'conflict', scenario);
    assert.equal(result.newPreview.catalogRevision, 'catalog-r2', scenario);
    assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 0, scenario);
    assert.equal(count(sqlite, 'atlas_place_identities'), 0, scenario);
  }
});

test('D1 Catalog delete atomically clears intake identity and snapshots while retaining recovery receipts and allowing re-add', async () => {
  const sqlite = await migratedDatabase();
  const database = toD1(sqlite);
  const firstPreview = verifiedPreview();
  const firstKey = '1'.repeat(64);
  insertPreviewSession(sqlite, firstPreview, firstKey);
  const ids = ['deleted-intake-item', 'readded-intake-item'];
  const publisher = new D1AtlasCatalogIntakePublisher(database, {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => ids.shift(),
  });
  assert.equal(
    (await publisher.publish(firstPreview, firstKey, 2, 'catalog-r1')).status,
    'committed_verified',
  );
  sqlite
    .prepare(
      'INSERT INTO atlas_review_candidates ' +
        '(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(
      'deleted-intake-item',
      JSON.stringify({ recordType: 'review_candidate' }),
      '2026-09-23T02:00:00.000Z',
      '2026-09-23T02:00:00.000Z',
    );

  await new D1DestructiveState(database).commitItemDeletion(
    'deleted-intake-item',
    '2026-09-23T02:01:00.000Z',
  );

  assert.equal(count(sqlite, 'atlas_items'), 0);
  assert.equal(count(sqlite, 'atlas_review_candidates'), 0);
  assert.equal(count(sqlite, 'atlas_place_identities'), 0);
  assert.equal(count(sqlite, 'atlas_item_location_snapshots'), 0);
  assert.equal(count(sqlite, 'atlas_item_tabelog_snapshots'), 0);
  assert.equal(count(sqlite, 'atlas_item_reservation_snapshots'), 0);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 1);
  assert.equal(count(sqlite, 'catalog_intake_terminal_refs'), 1);
  assert.equal(
    sqlite
      .prepare(
        'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1',
      )
      .get().revision_number,
    3,
  );

  const secondPreview = withDigest({
    ...verifiedPreview(),
    sessionId: 'session-2',
    catalogRevision: 'catalog-r3',
  });
  const secondKey = '2'.repeat(64);
  insertPreviewSession(sqlite, secondPreview, secondKey);
  assert.deepEqual(
    await publisher.publish(secondPreview, secondKey, 2, 'catalog-r3'),
    {
      status: 'committed_verified',
      itemId: 'readded-intake-item',
      receiptRef: secondKey,
      replayed: false,
    },
  );
  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(count(sqlite, 'atlas_place_identities'), 1);
});

test('AtlasApplication replays the committed D1 receipt after the first confirm response is lost', async () => {
  let now = new Date('2026-09-23T02:00:00.000Z');
  const sqlite = await migratedDatabase();
  const database = toD1(sqlite);
  const publisher = new D1AtlasCatalogIntakePublisher(database, {
    now: () => now,
    nextId: () => 'atlas-response-loss-1',
  });
  const candidate = {
    durableIdentity: {
      providerNamespace: 'google-places',
      placeId: 'place-response-loss',
      ordinal: 1,
    },
    transientPresentation: {
      name: 'Transient name',
      address: 'Transient address',
      attribution: {
        label: 'Google Maps',
        url: 'https://maps.google.com/',
      },
    },
  };
  const intakeModule = createCatalogIntakeModule({
    discoveryPort: {
      async discover() {
        return {
          ok: true,
          value: { candidates: [candidate], hasMore: false },
        };
      },
      async refetch() {
        return { ok: true, value: candidate };
      },
    },
    statePort: new D1CatalogIntakeState(database, { now: () => now }),
    atlasCatalogIntakePort: publisher,
    clock: { now: () => now },
    idSource: { nextId: () => 'session-response-loss' },
    catalogRevision: { read: async () => 'catalog-r1' },
  });
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup(intakeModule),
  );
  const context = {
    invocation: {
      ownerId: 'owner-1',
      channel: 'web',
      conversationId: 'conversation-response-loss',
    },
  };
  await application.execute(
    {
      key: 'catalog.intake.discover',
      input: { query: '鮨 さいとう', requestToken: 'response-loss-token' },
    },
    context,
  );
  await application.execute(
    {
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-response-loss',
        expectedSessionVersion: 1,
        ordinal: 1,
        ownerFields: {
          title: '鮨 さいとう',
          address: '東京都港区六本木1-4-5',
          coordinates: { latitude: 35.6654, longitude: 139.7298 },
        },
        requestResearch: false,
      },
    },
    context,
  );
  const confirm = {
    key: 'catalog.intake.confirm',
    input: {
      sessionId: 'session-response-loss',
      expectedPreviewVersion: 1,
    },
  };

  const committed = await application.execute(confirm, context);
  assert.equal(committed.ok, true);
  assert.equal(committed.value.status, 'committed_verified');
  assert.equal(committed.value.replayed, false);
  for (const invocation of [
    {
      ownerId: 'owner-2',
      channel: 'web',
      conversationId: 'conversation-response-loss',
    },
    {
      ownerId: 'owner-1',
      channel: 'external-client',
      conversationId: 'conversation-response-loss',
    },
    {
      ownerId: 'owner-1',
      channel: 'web',
      conversationId: 'another-conversation',
    },
  ]) {
    const rejected = await application.execute(confirm, { invocation });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, 'not_found');
  }
  assert.deepEqual(await application.execute(confirm, context), {
    ok: true,
    value: { ...committed.value, replayed: true },
  });
  now = new Date(
    Date.parse('2026-09-23T02:00:00.000Z') + 180 * 24 * 60 * 60 * 1000,
  );
  const expiredReplay = await application.execute(confirm, context);
  assert.equal(expiredReplay.ok, false);
  assert.equal(expiredReplay.error.code, 'not_found');
  assert.equal(count(sqlite, 'atlas_items'), 1);
  assert.equal(count(sqlite, 'catalog_intake_publish_receipts'), 1);
});

test('deterministic Agent Add publishes a verified D1 item that Catalog and Nearby can read', async () => {
  const now = new Date('2026-09-23T02:00:00.000Z');
  const sqlite = await migratedDatabase();
  const database = toD1(sqlite);
  const state = new D1CatalogIntakeState(database, { now: () => now });
  const catalog = createCatalogRead(new D1CatalogState(database), []);
  const candidate = {
    durableIdentity: {
      providerNamespace: 'google-places',
      placeId: 'place-agent-e2e',
      ordinal: 1,
    },
    transientPresentation: {
      name: 'Agent transient name',
      address: 'Agent transient address',
      attribution: {
        label: 'Google Maps',
        url: 'https://maps.google.com/',
      },
    },
  };
  const intakeModule = createCatalogIntakeModule({
    discoveryPort: {
      async discover() {
        return { ok: true, value: { candidates: [candidate], hasMore: false } };
      },
      async refetch() {
        return { ok: true, value: candidate };
      },
    },
    durableGeocoderPort: {
      async propose() {
        return {
          ok: true,
          value: {
            status: 'resolved',
            normalizedAddress: '東京都中央区銀座1-1-1',
            latitude: 35.671,
            longitude: 139.765,
            provider: 'fixture-durable-geocoder',
            sourceUrl: 'https://fixture.invalid/geocoder/agent-e2e',
            license: 'Fixture durable evidence',
            checkedAt: now.toISOString(),
          },
        };
      },
    },
    statePort: state,
    atlasCatalogIntakePort: new D1AtlasCatalogIntakePublisher(database, {
      now: () => now,
      nextId: () => 'agent-verified-1',
    }),
    clock: { now: () => now },
    idSource: { nextId: () => 'session-agent-e2e' },
    catalogRevision: { read: async () => 'catalog-r1' },
  });
  const application = createAtlasApplication({
    ...createCatalogIntakeOperationGroup(intakeModule),
    ...createNearbyRecommendationOperationGroup({
      clock: { now: () => now },
      routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
      catalog,
      locationResolver: {
        async resolve() {
          return {
            status: 'resolved',
            location: {
              canonicalAddress: '東京都中央区銀座',
              point: { latitude: 35.671, longitude: 139.764 },
            },
            attribution: {
              label: 'Fixture geocoder',
              url: 'https://fixture.invalid/geocoder',
            },
            provenance: {
              providerId: 'fixture-geocoder',
              policyVersion: 'fixture-v1',
              sourceUrl: 'https://fixture.invalid/geocoder?query=ginza',
              checkedAt: now.toISOString(),
            },
          };
        },
      },
      routeProvider: {
        async walking() {
          return {
            status: 'fresh',
            durationSeconds: 480,
            distanceMeters: 600,
            checkedAt: now.toISOString(),
            attribution: {
              label: 'Fixture routes',
              url: 'https://fixture.invalid/routes',
            },
          };
        },
      },
      entryAccessProvider: {
        async inspectWalkIn() {
          return {
            status: 'unknown',
            warning: 'Walk-in status is unavailable.',
          };
        },
        async inspectQueue() {
          return { status: 'unknown', warning: 'Queue status is unavailable.' };
        },
      },
      entryAccessPolicy: {
        policyVersion: 'fixture-entry-v1',
        allowedSourceOrigins: ['https://fixture.invalid'],
        maximumAgeMs: 5 * 60 * 1000,
        clock: { now: () => now },
      },
      personalFacts: {
        async read() {
          return { manualVisited: false, visitCount: 0 };
        },
      },
      mapDeepLink: (item) =>
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`,
    }),
  });
  const context = {
    requestToken: 'agent-e2e-request',
    invocation: {
      ownerId: 'owner-agent',
      channel: 'web',
      conversationId: 'owner-dm',
    },
  };

  const discovered = await application.execute(
    {
      key: 'catalog.intake.discover',
      input: { query: '銀座テスト店', requestToken: 'agent-e2e-request' },
    },
    context,
  );
  assert.equal(discovered.ok, true);
  const selected = await application.execute(
    {
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-agent-e2e',
        expectedSessionVersion: 1,
        ordinal: 1,
      },
    },
    context,
  );
  assert.equal(selected.ok, true);
  const committed = await application.execute(
    {
      key: 'catalog.intake.confirm',
      input: { sessionId: 'session-agent-e2e', expectedPreviewVersion: 1 },
    },
    context,
  );
  assert.equal(committed.ok, true);
  assert.equal(committed.value.status, 'committed_verified');

  const verified = await catalog.list('verified_catalog');
  assert.deepEqual(
    verified.map(({ id, title, address, verificationStatus }) => ({
      id,
      title,
      address,
      verificationStatus,
    })),
    [
      {
        id: 'agent-verified-1',
        title: '銀座テスト店',
        address: '東京都中央区銀座1-1-1',
        verificationStatus: 'verified',
      },
    ],
  );
  const nearby = await application.execute({
    key: 'nearby.recommend',
    input: { locationHint: '銀座' },
  });
  assert.equal(nearby.ok, true);
  assert.deepEqual(
    nearby.value.recommendations.map(({ itemId }) => itemId),
    ['agent-verified-1'],
  );
});

test('Add commits its Google reference atomically, retains its original date on replay, and deletes it with the place', async () => {
  const sqlite = await migratedDatabase();
  const preview = verifiedPreview();
  const mutationKey = 'a'.repeat(64);
  insertPreviewSession(sqlite, preview, mutationKey);
  const reference = {
    placeId: preview.candidateIdentity.placeId,
    score: 4.5,
    reviewCount: 123,
    url:
      'https://www.google.com/maps/search/?api=1&query_place_id=' +
      preview.candidateIdentity.placeId,
    observedAt: '2026-09-23T01:58:00.000Z',
    source: 'google_places_api',
  };
  sqlite
    .prepare(
      'UPDATE catalog_intake_sessions SET google_rating_reference_json = ? WHERE session_id = ?',
    )
    .run(JSON.stringify(reference), preview.sessionId);
  const database = toD1(sqlite);
  const publisher = new D1AtlasCatalogIntakePublisher(database, {
    now: () => new Date('2026-09-23T02:00:00.000Z'),
    nextId: () => 'place-with-reference',
  });
  const saved = await publisher.publish(preview, mutationKey, 2, 'catalog-r1');
  assert.equal(saved.status, 'committed_verified');
  const stored = () =>
    JSON.parse(
      sqlite
        .prepare('SELECT reference_json FROM atlas_google_rating_references')
        .get().reference_json,
    );
  assert.deepEqual(stored(), {
    ...reference,
    itemId: saved.itemId,
    capturedAt: '2026-09-23T02:00:00.000Z',
  });
  assert.equal(
    (await publisher.publish(preview, mutationKey, 2, 'catalog-r1')).replayed,
    true,
  );
  assert.equal(stored().score, 4.5);
  assert.equal(count(sqlite, 'catalog_intake_sessions'), 0);
  await new D1DestructiveState(database).commitItemDeletion(
    saved.itemId,
    '2026-09-24T00:00:00.000Z',
  );
  assert.equal(count(sqlite, 'atlas_google_rating_references'), 0);
});

test('a stale branch reference and a failed Add never create saved Google references', async () => {
  for (const fail of [false, true]) {
    const sqlite = await migratedDatabase();
    const preview = verifiedPreview();
    const mutationKey = 'b'.repeat(64);
    insertPreviewSession(sqlite, preview, mutationKey);
    sqlite
      .prepare(
        'UPDATE catalog_intake_sessions SET google_rating_reference_json = ? WHERE session_id = ?',
      )
      .run(
        JSON.stringify({
          placeId: fail ? preview.candidateIdentity.placeId : 'another-branch',
          score: 4.5,
          url: 'https://www.google.com/maps/',
          observedAt: '2026-09-23T01:58:00.000Z',
          source: 'google_places_api',
        }),
        preview.sessionId,
      );
    const database = toD1(sqlite, fail ? { failBatch: true } : {});
    // Use a SQLite trigger to force a real transaction failure after the item insert.
    if (fail)
      sqlite.exec(
        "CREATE TRIGGER reject_reference BEFORE INSERT ON atlas_google_rating_references BEGIN SELECT RAISE(ABORT, 'unavailable'); END",
      );
    const publisher = new D1AtlasCatalogIntakePublisher(database, {
      now: () => new Date('2026-09-23T02:00:00.000Z'),
      nextId: () => 'must-not-save-reference',
    });
    const result = await publisher.publish(
      preview,
      mutationKey,
      2,
      'catalog-r1',
    );
    assert.equal(
      result.status,
      fail ? 'failed_no_write' : 'committed_verified',
    );
    assert.equal(count(sqlite, 'atlas_google_rating_references'), 0);
    assert.equal(count(sqlite, 'atlas_items'), fail ? 0 : 1);
  }
});

async function migratedDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    baseMigration,
    sessionMigration,
    publicationMigration,
    researchAllowanceMigration,
    new URL(
      '../../../migrations/owner-poc/0012_google_rating_references.sql',
      import.meta.url,
    ),
  ]) {
    sqlite.exec(await readFile(migration, 'utf8'));
  }
  return sqlite;
}

function verifiedPreview() {
  return withDigest({
    sessionId: 'session-1',
    previewVersion: 1,
    state: 'preview_ready',
    candidateIdentity: {
      providerNamespace: 'google-places',
      placeId: 'place-1',
    },
    ownerFields: {
      title: '鮨 さいとう',
      address: '東京都港区六本木1-4-5',
      area: '六本木',
      coordinates: { latitude: 35.6654, longitude: 139.7298 },
    },
    locationEvidence: {
      status: 'known',
      provenance: 'owner_asserted',
      address: '東京都港区六本木1-4-5',
      latitude: 35.6654,
      longitude: 139.7298,
      assertedAt: '2026-09-23T01:59:00.000Z',
    },
    tabelog: {
      status: 'known',
      score: 4.25,
      reviewCount: 120,
      url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/',
      provenance: 'owner_asserted',
      assertedAt: '2026-09-23T01:59:00.000Z',
      freshness: 'fresh',
    },
    reservation: {
      status: 'known',
      mode: 'reservation_required',
      label: 'Advance reservation required',
      advanceDays: 30,
      url: 'https://example.com/reservations',
      provenance: 'owner_asserted',
      assertedAt: '2026-09-23T01:59:00.000Z',
      freshness: 'fresh',
    },
    suspectedDuplicates: [],
    unknownFields: [],
    warnings: [],
    catalogRevision: 'catalog-r1',
    expiresAt: '2026-09-23T02:29:00.000Z',
  });
}

function withDigest(preview) {
  const { evidenceDigest: _priorDigest, ...withoutDigest } = preview;
  return {
    ...withoutDigest,
    evidenceDigest: createHash('sha256')
      .update(canonicalJson(withoutDigest))
      .digest('hex'),
  };
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function insertPreviewSession(sqlite, preview, confirmMutationKey) {
  const session = {
    sessionId: preview.sessionId,
    sessionVersion: 2,
    state: 'preview_ready',
    ownerId: 'owner-1',
    channel: 'web',
    conversationId:
      preview.sessionId === 'session-1'
        ? 'conversation-1'
        : `conversation-${preview.sessionId}`,
    ownerQuery: '鮨 さいとう',
    normalizedOwnerQuery: '鮨 さいとう',
    requestToken:
      preview.sessionId === 'session-1'
        ? 'request-1'
        : `request-${preview.sessionId}`,
    hasMore: false,
    candidates: [
      {
        ...preview.candidateIdentity,
        ordinal: 1,
        createdAt: '2026-09-23T01:58:00.000Z',
      },
    ],
    catalogRevision: preview.catalogRevision,
    createdAt: '2026-09-23T01:58:00.000Z',
    discoverExpiresAt: preview.expiresAt,
    lastAcceptedActivityAt: '2026-09-23T01:59:00.000Z',
    expiresAt: preview.expiresAt,
    preview,
    ...(confirmMutationKey ? { confirmMutationKey } : {}),
  };
  sqlite
    .prepare(
      'INSERT INTO catalog_intake_sessions ' +
        '(session_id, owner_id, channel, conversation_id, state, ' +
        'session_version, request_token, normalized_owner_query, session_json, ' +
        'last_accepted_activity_at_ms, expires_at_ms, created_at_ms, updated_at_ms) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      session.sessionId,
      session.ownerId,
      session.channel,
      session.conversationId,
      session.state,
      session.sessionVersion,
      session.requestToken,
      session.normalizedOwnerQuery,
      JSON.stringify(session),
      Date.parse(session.lastAcceptedActivityAt),
      Date.parse(session.expiresAt),
      Date.parse(session.createdAt),
      Date.parse(session.lastAcceptedActivityAt),
    );
}

function claimPreviewSession(sqlite, preview, mutationKey, sessionVersion) {
  const row = sqlite
    .prepare(
      'SELECT session_json FROM catalog_intake_sessions WHERE session_id = ?',
    )
    .get(preview.sessionId);
  const session = JSON.parse(row.session_json);
  session.sessionVersion = sessionVersion;
  session.confirmMutationKey = mutationKey;
  sqlite
    .prepare(
      'UPDATE catalog_intake_sessions SET session_version = ?, session_json = ? ' +
        'WHERE session_id = ?',
    )
    .run(sessionVersion, JSON.stringify(session), preview.sessionId);
}

function count(sqlite, table) {
  return sqlite.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count;
}

function toD1(database, options = {}) {
  let throwAfterCommit = options.throwAfterCommitOnce === true;
  let batchTail = Promise.resolve();
  let initialReceiptReads = 0;
  let initialRevisionReads = 0;
  let releaseReceiptReads;
  let releaseRevisionReads;
  let beforeFirstBatch = options.beforeFirstBatchOnce;
  let batchCommitted = false;
  let failRecoveryReceiptRead = options.failRecoveryReceiptReadOnce === true;
  const receiptReadBarrier = new Promise((resolve) => {
    releaseReceiptReads = resolve;
  });
  const revisionReadBarrier = new Promise((resolve) => {
    releaseRevisionReads = resolve;
  });
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
        if (
          failRecoveryReceiptRead &&
          batchCommitted &&
          sql.includes('catalog_intake_publish_receipts')
        ) {
          failRecoveryReceiptRead = false;
          throw new Error('simulated lost receipt recovery read');
        }
        if (
          options.barrierInitialReceiptReads &&
          sql.includes('catalog_intake_publish_receipts') &&
          initialReceiptReads < options.barrierInitialReceiptReads
        ) {
          initialReceiptReads += 1;
          if (initialReceiptReads === options.barrierInitialReceiptReads) {
            releaseReceiptReads();
          }
          await receiptReadBarrier;
        }
        if (
          options.barrierInitialRevisionReads &&
          sql.includes('FROM atlas_catalog_revision') &&
          initialRevisionReads < options.barrierInitialRevisionReads
        ) {
          initialRevisionReads += 1;
          if (initialRevisionReads === options.barrierInitialRevisionReads) {
            releaseRevisionReads();
          }
          await revisionReadBarrier;
        }
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
      const execute = async () => {
        if (beforeFirstBatch) {
          const runBeforeBatch = beforeFirstBatch;
          beforeFirstBatch = undefined;
          await runBeforeBatch();
        }
        let committed = false;
        database.exec('BEGIN IMMEDIATE');
        try {
          const results = [];
          for (const statement of statements) {
            results.push(await statement.run());
          }
          database.exec('COMMIT');
          committed = true;
          batchCommitted = true;
          if (throwAfterCommit) {
            throwAfterCommit = false;
            throw new Error('simulated lost D1 acknowledgement after commit');
          }
          return results;
        } catch (error) {
          if (!committed) database.exec('ROLLBACK');
          throw error;
        }
      };
      if (!options.serializeBatch) return execute();
      const result = batchTail.then(execute);
      batchTail = result.catch(() => undefined);
      return result;
    },
  };
}
