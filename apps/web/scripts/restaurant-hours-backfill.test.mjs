import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { planRestaurantHoursBackfill } from './restaurant-hours-backfill.mjs';

const claim = {
  value: '月・火 11:00 - 14:00 / 17:00 - 22:00',
  sourceUrl: 'https://restaurant.example/branch',
  observedAt: '2026-10-04T00:00:00.000Z',
};
const benchmark = {
  cases: [
    {
      id: 'sample',
      itemId: 'restaurant',
      name: 'Restaurant',
      listingUrl: 'https://tabelog.com/tokyo/A1304/A130401/13247487/',
      openingHours: claim,
      evidence: [{ sourceUrl: claim.sourceUrl }],
    },
  ],
};
const item = {
  id: 'restaurant',
  title: 'Restaurant',
  kind: 'food',
  description: 'Preserve',
  personalState: 'visited',
  reservation: { url: 'https://booking.example/' },
  intakeEvidence: {
    tabelog: { url: benchmark.cases[0].listingUrl },
    profile: { bookingLink: { value: 'https://booking.example/' } },
  },
};
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE atlas_items(id TEXT PRIMARY KEY,payload_json TEXT,updated_at TEXT); CREATE TABLE maintenance_control(id INTEGER,write_revision INTEGER); INSERT INTO maintenance_control VALUES(1,0);',
  );
  db.prepare('INSERT INTO atlas_items VALUES(?,?,?)').run(
    item.id,
    JSON.stringify(item),
    '2026-09-24',
  );
  return db;
}
test('schedule check retains the newest field observation rather than the final field order', () => {
  const db = fixture();
  const sample = {
    ...benchmark.cases[0],
    openingHours: { ...claim, observedAt: '2026-10-04T07:00:00.000Z' },
    regularClosingDays: {
      ...claim,
      value: '月曜日',
      observedAt: '2026-10-04T05:00:00.000Z',
    },
    hoursStatus: 'known',
    weeklyClosureStatus: 'known',
  };
  db.exec(
    planRestaurantHoursBackfill(db.prepare('SELECT * FROM atlas_items').all(), {
      cases: [sample],
    }).sql,
  );
  const stored = JSON.parse(
    db.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  assert.equal(stored.scheduleCheck.checkedAt, sample.openingHours.observedAt);
  assert.equal(
    stored.regularClosingDays.observedAt,
    sample.regularClosingDays.observedAt,
  );
  db.close();
});
test('hours backfill preserves links and profile, is idempotent and can roll back', () => {
  const db = fixture();
  const rows = db.prepare('SELECT * FROM atlas_items').all();
  const plan = planRestaurantHoursBackfill(rows, benchmark);
  db.exec(plan.sql);
  const stored = JSON.parse(
    db.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  assert.deepEqual(stored.openingHours, claim);
  assert.equal(stored.regularClosingDays, undefined);
  assert.deepEqual(stored.intakeEvidence, item.intakeEvidence);
  assert.deepEqual(stored.reservation, item.reservation);
  assert.equal(stored.personalState, 'visited');
  const repeated = planRestaurantHoursBackfill(
    db.prepare('SELECT * FROM atlas_items').all(),
    benchmark,
  );
  assert.equal(repeated.sql, '');
  assert.equal(
    db.prepare('SELECT write_revision FROM maintenance_control').get()
      .write_revision,
    1,
  );
  db.exec(plan.rollbackSql);
  assert.deepEqual(
    JSON.parse(
      db.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
    ),
    item,
  );
  db.close();
});
test('a concurrent edit defeats schedule CAS and never increments the revision', () => {
  const db = fixture();
  const plan = planRestaurantHoursBackfill(
    db.prepare('SELECT * FROM atlas_items').all(),
    benchmark,
  );
  db.prepare('UPDATE atlas_items SET updated_at=?').run('concurrent');
  db.exec(plan.sql);
  assert.equal(
    JSON.parse(
      db.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
    ).openingHours,
    undefined,
  );
  assert.equal(
    db.prepare('SELECT write_revision FROM maintenance_control').get()
      .write_revision,
    0,
  );
  db.close();
});
test('changed restaurant identity and unproven or malformed schedule fail closed', () => {
  const rows = [
    { id: item.id, payload_json: JSON.stringify(item), updated_at: 'old' },
  ];
  for (const sample of [
    { ...benchmark.cases[0], name: 'Other Restaurant' },
    { ...benchmark.cases[0], evidence: [] },
    {
      ...benchmark.cases[0],
      openingHours: { ...claim, sourceUrl: 'http://restaurant.example/branch' },
    },
    {
      ...benchmark.cases[0],
      openingHours: { ...claim, observedAt: '2026-10-04' },
    },
  ])
    assert.throws(() => planRestaurantHoursBackfill(rows, { cases: [sample] }));
});

test('all-restaurant scope rejects incomplete coverage and duplicate targets', () => {
  const rows = [
    { id: item.id, payload_json: JSON.stringify(item), updated_at: 'old' },
  ];
  const all = { ...benchmark, scope: 'all_existing_restaurants' };
  assert.throws(
    () => planRestaurantHoursBackfill(rows, { ...all, cases: [] }),
    /every existing restaurant/u,
  );
  assert.throws(
    () =>
      planRestaurantHoursBackfill(rows, {
        ...all,
        cases: [...all.cases, ...all.cases],
      }),
    /Duplicate/u,
  );
  assert.equal(planRestaurantHoursBackfill(rows, all).entries.length, 1);
});

test('checked missing policies remain unavailable and a seasonal note never creates a weekly closure', () => {
  const rows = [
    { id: item.id, payload_json: JSON.stringify(item), updated_at: 'old' },
  ];
  const sample = {
    ...benchmark.cases[0],
    hoursStatus: 'known',
    weeklyClosureStatus: 'unavailable',
    closingNotes: { ...claim, value: '年末年始' },
  };
  const db = fixture();
  db.exec(
    planRestaurantHoursBackfill(
      rows.map((row) => ({ ...row, updated_at: '2026-09-24' })),
      { cases: [sample] },
    ).sql,
  );
  const next = JSON.parse(
    db.prepare('SELECT payload_json FROM atlas_items').get().payload_json,
  );
  assert.deepEqual(next.scheduleCheck, {
    openingHours: 'known',
    regularClosingDays: 'unavailable',
    checkedAt: claim.observedAt,
  });
  assert.equal(next.regularClosingDays, undefined);
  assert.equal(next.closingNotes.value, '年末年始');
  assert.throws(
    () =>
      planRestaurantHoursBackfill(rows, {
        cases: [{ ...sample, weeklyClosureStatus: 'known' }],
      }),
    /Inconsistent/u,
  );
  db.close();
});
