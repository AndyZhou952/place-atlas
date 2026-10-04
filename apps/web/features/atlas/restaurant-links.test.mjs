import assert from 'node:assert/strict';
import test from 'node:test';
import { restaurantLinks } from './restaurant-links.ts';

const tabelog = 'https://tabelog.com/tokyo/A1317/A131701/13213575/';
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
  const official = 'https://gf-restaurant.jp/rodeo/nakameguro';
  const booking = 'https://yoyaku.toreta.in/rodeo-nakameguro/#/';
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
