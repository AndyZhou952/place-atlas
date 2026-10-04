import assert from 'node:assert/strict';
import test from 'node:test';
import { restaurantLinks } from './restaurant-links.ts';

const tabelog = 'https://tabelog.com/tokyo/A1317/A131701/13000001/';
const item = {
  kind: 'food',
  tabelog: { url: tabelog },
  reservation: { label: '予約可' },
  sources: [
    { role: 'tabelog', label: 'Tabelog', url: tabelog },
    { role: 'reservation', label: '予約可', url: tabelog },
  ],
};

test('policy-only restaurants keep one Tabelog destination without invented links', () => {
  assert.deepEqual(restaurantLinks(item), [item.sources[0]]);
  assert.deepEqual(
    restaurantLinks({
      ...item,
      officialUrl: tabelog,
      reservation: { label: '予約不可', url: `${tabelog}#reservation` },
    }),
    [item.sources[0]],
  );
});

test('independent official and booking destinations retain the Toreta route', () => {
  const official = 'https://kitchen.example/selected';
  const booking = 'https://yoyaku.toreta.in/fixture-kitchen/#/';
  assert.deepEqual(
    restaurantLinks({
      ...item,
      officialUrl: official,
      reservation: { ...item.reservation, url: booking },
    }),
    [
      item.sources[0],
      { role: 'official', label: 'Official website', url: official },
      { role: 'reservation', label: 'Booking', url: booking },
    ],
  );
});

test('the same official and booking page is displayed once', () => {
  const official = 'https://example.com/restaurant/';
  assert.equal(
    restaurantLinks({
      ...item,
      officialUrl: official,
      reservation: {
        ...item.reservation,
        url: 'https://example.com/restaurant',
      },
    }).length,
    2,
  );
});

test('ordinary section anchors do not create duplicate website buttons', () => {
  const official = 'https://example.com/restaurant/';
  assert.deepEqual(
    restaurantLinks({
      ...item,
      officialUrl: official,
      reservation: { ...item.reservation, url: `${official}#reservation` },
    }),
    [
      item.sources[0],
      { role: 'official', label: 'Official website', url: official },
    ],
  );
});

test('known Tabelog schedule provenance supplies the listing link when rating and source links are absent', () => {
  const scheduleListing = 'https://tabelog.com/tokyo/A1303/A130301/13292348/';
  const official = 'https://restaurant.example/';
  assert.deepEqual(
    restaurantLinks({
      kind: 'food',
      officialUrl: official,
      reservation: { label: 'Unknown' },
      sources: [],
      openingHours: {
        value: '11:00–20:00',
        sourceUrl: scheduleListing,
        observedAt: '2026-10-04T00:00:00.000Z',
      },
      scheduleCheck: {
        openingHours: 'known',
        regularClosingDays: 'unavailable',
        checkedAt: '2026-10-04T00:00:00.000Z',
      },
    }),
    [
      { role: 'tabelog', label: 'Tabelog', url: scheduleListing },
      { role: 'official', label: 'Official website', url: official },
    ],
  );
});

test('schedule-link fallback rejects non-listing Tabelog URLs and unavailable claims', () => {
  const official = 'https://restaurant.example/';
  const base = {
    kind: 'food',
    officialUrl: official,
    reservation: { label: 'Unknown' },
    sources: [],
  };
  for (const sourceUrl of [
    'https://tabelog.com/tokyo/A1301/A130101/13157424/dtlrvwlst/',
    'https://tabelog.com/rst/ranking/',
    'https://www.tabelog.com/tokyo/A1301/A130101/13157424/',
    'http://tabelog.com/tokyo/A1301/A130101/13157424/',
  ]) {
    assert.deepEqual(
      restaurantLinks({
        ...base,
        openingHours: {
          value: '11:00–20:00',
          sourceUrl,
          observedAt: '2026-10-04T00:00:00.000Z',
        },
      }),
      [{ role: 'official', label: 'Official website', url: official }],
      sourceUrl,
    );
  }
  assert.deepEqual(
    restaurantLinks({
      ...base,
      openingHours: {
        value: '11:00–20:00',
        sourceUrl: 'https://tabelog.com/tokyo/A1301/A130101/13157424/',
        observedAt: '2026-10-04T00:00:00.000Z',
      },
      scheduleCheck: {
        openingHours: 'unavailable',
        regularClosingDays: 'unavailable',
        checkedAt: '2026-10-04T00:00:00.000Z',
      },
    }),
    [{ role: 'official', label: 'Official website', url: official }],
  );
});

test('schedule-source fallback also recognizes seven-digit regional Tabelog listings', () => {
  const sourceUrl = 'https://tabelog.com/aomori/A0201/A020101/2000092/';
  assert.deepEqual(
    restaurantLinks({
      kind: 'food',
      reservation: { label: 'Unknown' },
      sources: [],
      openingHours: {
        value: '10:00–18:00',
        sourceUrl,
        observedAt: '2026-10-04T00:00:00.000Z',
      },
    }),
    [{ role: 'tabelog', label: 'Tabelog', url: sourceUrl }],
  );
});
