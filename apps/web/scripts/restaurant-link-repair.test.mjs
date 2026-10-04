import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { planRestaurantLinkRepair } from './restaurant-link-repair.mjs';

const observedAt = '2026-10-04T00:00:00.000Z';
const shimaId = '7cde3b6c-b853-4102-a4ad-8ab1a4c53170';
const rodeoId = '9fe5a165-0776-4a57-af42-a9a607fcca62';
const shimaTabelog = 'https://tabelog.com/tokyo/A1304/A130401/13247487/';
const rodeoTabelog = 'https://tabelog.com/tokyo/A1317/A131701/13213575/';
const shimaBooking =
  'https://www.tablecheck.com/ja/shops/ramenya-shima/reserve';
const rodeoBooking = 'https://yoyaku.toreta.in/rodeo-nakameguro/#/';
const rodeoReservation = 'https://yoyaku.toreta.in/rodeo-nakameguro/';
const rodeoOfficial = 'https://gf-restaurant.jp/rodeo/nakameguro';

function makePayload({ id, title, tabelogUrl, address, oldOfficialUrl }) {
  return {
    id,
    kind: 'food',
    title,
    area: 'test-area',
    address,
    description: 'preserve this text',
    latitude: 35.6,
    longitude: 139.7,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-24T08:30:00.000Z',
    reservation: {
      mode: 'advance',
      label: '予約可',
      url: tabelogUrl,
    },
    personalState: 'visited',
    personalRating: 4.5,
    isFavorite: true,
    hasVisited: true,
    visitCount: 3,
    media: [{ objectKey: `private/${id}.jpg`, caption: 'keep media' }],
    tags: ['ラーメン'],
    sources: [
      { label: 'Tabelog branch listing', url: tabelogUrl, role: 'tabelog' },
      ...(oldOfficialUrl
        ? [
            {
              label: 'Official restaurant page',
              url: oldOfficialUrl,
              role: 'official',
            },
          ]
        : []),
    ],
    intakeEvidence: {
      candidateIdentity: {
        providerNamespace: 'google-places',
        placeId: `place-${id}`,
      },
      ownerFields: { title, address, area: 'test-area' },
      locationEvidence: {
        status: 'known',
        assertedAt: '2026-09-24T08:00:00.000Z',
      },
      tabelog: { status: 'known', score: 4, url: tabelogUrl },
      reservation: {
        status: 'known',
        mode: 'reservation_required',
        label: '予約可',
        url: tabelogUrl,
        provenance: 'owner_asserted',
        assertedAt: '2026-09-24T08:00:00.000Z',
        freshness: 'fresh',
      },
      unknownFields: [],
      warnings: [],
    },
    updatedAt: '2026-09-27T14:02:50.371Z',
    classification: { cuisines: ['preserve'], basis: { address } },
    ...(oldOfficialUrl ? { officialUrl: oldOfficialUrl } : {}),
  };
}

function fixtureRows() {
  const shima = makePayload({
    id: shimaId,
    title: 'らぁ麺や 嶋',
    tabelogUrl: shimaTabelog,
    address: '東京都渋谷区本町３丁目４１−１１',
  });
  const rodeo = makePayload({
    id: rodeoId,
    title: 'RODEO',
    tabelogUrl: rodeoTabelog,
    address: '東京都目黒区中目黒３丁目５−１',
    oldOfficialUrl: 'https://gf-restaurant.jp/rodeo',
  });
  return [shima, rodeo].map((payload) => ({
    id: payload.id,
    payload_json: JSON.stringify(payload),
    updated_at: '2026-09-27T14:02:50.371Z',
  }));
}

function wrapped(rows) {
  return [{ results: rows }];
}

function createDatabase(rows) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE atlas_items (
      id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE maintenance_control (
      id INTEGER PRIMARY KEY,
      write_revision INTEGER NOT NULL
    );
    INSERT INTO maintenance_control VALUES (1, 7);
    CREATE TABLE visits (item_id TEXT, rating REAL, media_key TEXT);
  `);
  const insert = database.prepare(
    'INSERT INTO atlas_items (id, payload_json, updated_at) VALUES (?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(row.id, row.payload_json, row.updated_at);
    database
      .prepare('INSERT INTO visits VALUES (?, ?, ?)')
      .run(row.id, 5, `visit-media/${row.id}.jpg`);
  }
  return database;
}

const payloadById = (database, id) =>
  JSON.parse(
    database
      .prepare('SELECT payload_json FROM atlas_items WHERE id = ?')
      .get(id).payload_json,
  );

test('planner repairs only the two source-backed links and preserves user data', () => {
  const rows = fixtureRows();
  const plan = planRestaurantLinkRepair(wrapped(rows));
  assert.equal(plan.report.targetCount, 2);
  assert.equal(plan.report.changedCount, 2);
  assert.match(plan.sql, /UPDATE atlas_items/u);
  assert.match(plan.sql, /UPDATE maintenance_control SET write_revision/u);
  assert.match(plan.sql, /AND payload_json =/u);
  assert.match(
    plan.sql,
    /json_extract\(payload_json, '\$\.reservation\.url'\)/u,
  );
  assert.match(
    plan.backupSql,
    /SELECT id, payload_json, updated_at FROM atlas_items/u,
  );
  assert.match(plan.rollbackSql, /AND payload_json =/u);
  assert.match(plan.assertionsSql, /bookingLink\.value/u);
  const database = createDatabase(rows);
  database.exec(plan.sql);

  const shima = payloadById(database, shimaId);
  assert.equal(shima.reservation.url, shimaBooking);
  assert.equal(shima.intakeEvidence.reservation.url, shimaTabelog);
  assert.equal(shima.intakeEvidence.reservation.provenance, 'owner_asserted');
  assert.deepEqual(
    shima.intakeEvidence.reservation,
    JSON.parse(rows[0].payload_json).intakeEvidence.reservation,
  );
  assert.equal(shima.intakeEvidence.profile.bookingLink.value, shimaBooking);
  assert.equal(
    shima.intakeEvidence.profile.bookingLink.sourceUrl,
    shimaBooking,
  );
  assert.equal(shima.intakeEvidence.profile.bookingLink.observedAt, observedAt);
  assert.equal(shima.officialUrl, undefined);
  assert.equal(shima.intakeEvidence.profile.officialWebsite, undefined);
  assert.ok(
    shima.sources.some(
      (source) => source.role === 'reservation' && source.url === shimaBooking,
    ),
  );

  const rodeo = payloadById(database, rodeoId);
  assert.equal(rodeo.officialUrl, rodeoOfficial);
  assert.equal(rodeo.reservation.url, rodeoReservation);
  assert.equal(rodeo.intakeEvidence.reservation.url, rodeoTabelog);
  assert.equal(rodeo.intakeEvidence.reservation.provenance, 'owner_asserted');
  assert.deepEqual(
    rodeo.intakeEvidence.reservation,
    JSON.parse(rows[1].payload_json).intakeEvidence.reservation,
  );
  assert.equal(
    rodeo.intakeEvidence.profile.officialWebsite.value,
    rodeoOfficial,
  );
  assert.equal(
    rodeo.intakeEvidence.profile.officialWebsite.sourceUrl,
    rodeoOfficial,
  );
  assert.equal(rodeo.intakeEvidence.profile.bookingLink.value, rodeoBooking);
  assert.ok(
    rodeo.sources.some(
      (source) => source.role === 'official' && source.url === rodeoOfficial,
    ),
  );
  assert.ok(
    rodeo.sources.some(
      (source) => source.role === 'reservation' && source.url === rodeoBooking,
    ),
  );
  assert.doesNotMatch(rodeo.reservation.url, /#/u);
  assert.doesNotMatch(rodeo.intakeEvidence.reservation.url, /#/u);
  assert.match(rodeo.intakeEvidence.profile.bookingLink.value, /#\/$/u);

  for (const [before, after] of [
    [JSON.parse(rows[0].payload_json), shima],
    [JSON.parse(rows[1].payload_json), rodeo],
  ]) {
    for (const key of [
      'personalState',
      'personalRating',
      'isFavorite',
      'hasVisited',
      'visitCount',
      'media',
      'classification',
      'description',
      'address',
      'latitude',
      'longitude',
      'verifiedAt',
      'tags',
    ])
      assert.deepEqual(after[key], before[key], `${key} is preserved`);
  }
  assert.deepEqual(
    database
      .prepare('SELECT * FROM visits ORDER BY item_id')
      .all()
      .map((row) => ({ ...row })),
    [
      { item_id: shimaId, rating: 5, media_key: `visit-media/${shimaId}.jpg` },
      { item_id: rodeoId, rating: 5, media_key: `visit-media/${rodeoId}.jpg` },
    ],
  );
  assert.equal(
    database.prepare('SELECT write_revision FROM maintenance_control').get()
      .write_revision,
    9,
  );
  const readback = plan.assertionsSql
    .split(';')
    .filter((statement) => statement.trim())
    .map((statement) => database.prepare(statement).all());
  assert.deepEqual(
    readback
      .slice(0, 2)
      .flat()
      .map((row) => row.links_match),
    [1, 1],
  );
  database.close();
});

test('planner is idempotent and its guarded rollback restores exact originals', () => {
  const rows = fixtureRows();
  const firstPlan = planRestaurantLinkRepair(wrapped(rows));
  const database = createDatabase(rows);
  database.exec(firstPlan.sql);

  const repairedRows = database
    .prepare('SELECT id, payload_json, updated_at FROM atlas_items ORDER BY id')
    .all();
  const secondPlan = planRestaurantLinkRepair(wrapped(repairedRows));
  assert.equal(secondPlan.report.changedCount, 0);
  assert.equal(secondPlan.sql, '');
  assert.equal(secondPlan.rollbackSql, '');

  database.exec(firstPlan.rollbackSql);
  for (const row of rows) {
    const restored = database
      .prepare('SELECT payload_json, updated_at FROM atlas_items WHERE id = ?')
      .get(row.id);
    assert.equal(restored.payload_json, row.payload_json);
    assert.equal(restored.updated_at, row.updated_at);
  }
  assert.equal(
    database.prepare('SELECT write_revision FROM maintenance_control').get()
      .write_revision,
    11,
  );
  database.close();
});

test('compare-and-swap skips a concurrently edited row and advances revision only for a matched row', () => {
  const rows = fixtureRows();
  const plan = planRestaurantLinkRepair(wrapped(rows));
  const database = createDatabase(rows);
  const current = payloadById(database, shimaId);
  current.description = 'new owner edit';
  database
    .prepare('UPDATE atlas_items SET payload_json = ? WHERE id = ?')
    .run(JSON.stringify(current), shimaId);

  database.exec(plan.sql);
  assert.equal(payloadById(database, shimaId).description, 'new owner edit');
  assert.equal(payloadById(database, shimaId).reservation.url, shimaTabelog);
  assert.equal(
    payloadById(database, rodeoId).reservation.url,
    rodeoReservation,
  );
  assert.equal(
    database.prepare('SELECT write_revision FROM maintenance_control').get()
      .write_revision,
    8,
  );
  database.close();
});

test('planner rejects missing targets, changed prior URLs, duplicate rows, and unexpected official URLs', () => {
  const rows = fixtureRows();
  assert.throws(() => planRestaurantLinkRepair([]), /no atlas_items/u);
  assert.throws(
    () => planRestaurantLinkRepair(wrapped(rows.slice(0, 1))),
    /missing/u,
  );
  assert.throws(
    () => planRestaurantLinkRepair(wrapped([...rows, rows[0]])),
    /duplicate/u,
  );

  const changedReservation = JSON.parse(rows[0].payload_json);
  changedReservation.reservation.url = 'https://unverified.example/book';
  assert.throws(
    () =>
      planRestaurantLinkRepair(
        wrapped([
          { ...rows[0], payload_json: JSON.stringify(changedReservation) },
          rows[1],
        ]),
      ),
    /unexpected identity or old URL/u,
  );

  const changedOfficial = JSON.parse(rows[1].payload_json);
  changedOfficial.officialUrl = 'https://unverified.example/rodeo';
  assert.throws(
    () =>
      planRestaurantLinkRepair(
        wrapped([
          rows[0],
          { ...rows[1], payload_json: JSON.stringify(changedOfficial) },
        ]),
      ),
    /unexpected official URL/u,
  );
});

test('a concurrent change prevents the guarded rollback from overwriting it', () => {
  const rows = fixtureRows();
  const plan = planRestaurantLinkRepair(wrapped(rows));
  const database = createDatabase(rows);
  database.exec(plan.sql);
  const current = payloadById(database, shimaId);
  current.description = 'changed after repair';
  database
    .prepare('UPDATE atlas_items SET payload_json = ? WHERE id = ?')
    .run(JSON.stringify(current), shimaId);
  database.exec(plan.rollbackSql);
  assert.equal(
    payloadById(database, shimaId).description,
    'changed after repair',
  );
  assert.equal(payloadById(database, rodeoId).reservation.url, rodeoTabelog);
  database.close();
});
