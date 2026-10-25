import assert from 'node:assert/strict';
import test from 'node:test';
import { toPayload, toRestaurant } from '../src/server/record.ts';
import type { AddDraft } from '../src/shared/types.ts';
import { LISTING_URL } from './fixtures.ts';

const at = '2026-10-01T00:00:00.000Z';
const row = (payload: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'r1',
  payload_json: JSON.stringify(payload),
  created_at: at,
  updated_at: at,
  ...extra,
});

// The 0.1 Add flow stored facts under intakeEvidence; the public fields were projections.
const intakeRecord = {
  id: 'r1',
  kind: 'food',
  title: '助六',
  area: '青森市新町',
  address: '青森県青森市新町1-6-25',
  description: '主营烧鸟。',
  latitude: 40.82,
  longitude: 140.73,
  verificationStatus: 'verified',
  verifiedAt: at,
  personalState: 'saved',
  tags: ['焼き鳥', '居酒屋'],
  reservation: { mode: 'unknown', label: 'Reservation status is unknown.' },
  openingHours: { value: '月〜日 11:00–20:00', sourceUrl: LISTING_URL, observedAt: at },
  scheduleCheck: { openingHours: 'known', regularClosingDays: 'unavailable', checkedAt: at },
  intakeEvidence: {
    candidateIdentity: { providerNamespace: 'google-places', placeId: 'ChIJ0c1ykh6fm18RfJT3' },
    ownerFields: { categories: ['焼き鳥', '居酒屋'] },
    tabelog: {
      status: 'known',
      score: 3.48,
      url: LISTING_URL,
      provenance: 'agent_observed',
      observedAt: at,
      freshness: 'fresh',
    },
    reservation: {
      status: 'known',
      mode: 'reservable',
      label: '予約可',
      url: LISTING_URL,
      provenance: 'agent_observed',
      observedAt: at,
      freshness: 'fresh',
    },
    profile: {
      bookingLink: {
        value: 'https://yoyaku.toreta.in/test/#/',
        sourceUrl: LISTING_URL,
        observedAt: at,
      },
    },
    locationEvidence: { status: 'unknown' },
    unknownFields: [],
    warnings: [],
  },
};

test('0.1 Add records are read from their intake evidence', () => {
  const restaurant = toRestaurant(
    row(intakeRecord, {
      overall_rating: 8,
      is_favorite: 1,
      has_visited: 0,
      visit_count: 2,
      summary: 'Good',
    }),
  )!;
  assert.deepEqual(restaurant.tabelog, { url: LISTING_URL, score: 3.48 });
  assert.equal(restaurant.googlePlaceId, 'ChIJ0c1ykh6fm18RfJT3');
  assert.deepEqual(restaurant.reservation, {
    policy: 'reservable',
    label: '予約可',
    bookingUrl: 'https://yoyaku.toreta.in/test/#/',
  });
  assert.deepEqual(restaurant.cuisines, ['japanese.yakitori', 'japanese.izakaya']);
  assert.equal(restaurant.prefecture, 'JP-02');
  assert.equal(restaurant.regularClosingDays, undefined, 'schedule check marked it unavailable');
  assert.deepEqual(
    [restaurant.rating, restaurant.favorite, restaurant.visited, restaurant.comment],
    [8, true, true, 'Good'],
  );
});

test('flat records, title overrides, and the Tabelog URL is never a booking link', () => {
  const flat = {
    ...intakeRecord,
    intakeEvidence: undefined,
    googlePlaceId: 'ChIJflatplace123',
    tabelog: { score: 3.6, url: LISTING_URL, checkedAt: at },
    reservation: {
      mode: 'advance',
      label: '完全予約制',
      url: LISTING_URL,
      bookingWindowLabel: '2週間前から',
    },
  };
  const restaurant = toRestaurant(
    row(flat, { override_title: 'Renamed', override_description: '' }),
  )!;
  assert.equal(restaurant.title, 'Renamed');
  assert.equal(restaurant.description, '');
  assert.deepEqual(restaurant.reservation, {
    policy: 'required',
    label: '完全予約制',
    note: '2週間前から',
  });
  assert.equal(restaurant.visited, false);
});

test('events, architecture, review candidates and broken payloads are not restaurants', () => {
  for (const payload of [
    { ...intakeRecord, kind: 'event' },
    { ...intakeRecord, kind: 'architecture' },
    { ...intakeRecord, verificationStatus: 'needs_review' },
    { ...intakeRecord, latitude: undefined },
  ]) {
    assert.equal(toRestaurant(row(payload)), undefined);
  }
  assert.equal(toRestaurant({ ...row({}), payload_json: '{' }), undefined);
});

test('a new record round-trips through the stored payload', () => {
  const draft: AddDraft = {
    id: 'new-1',
    title: '鮨 テスト',
    area: '目黒区中目黒',
    address: '東京都目黒区中目黒1-1-1',
    latitude: 35.64,
    longitude: 139.7,
    description: '主营寿司。',
    categories: ['寿司', '海鮮', '和食'],
    dishes: ['穴子寿司'],
    tabelog: { url: LISTING_URL, score: 3.62 },
    reservation: { policy: 'not_reservable', label: '予約不可' },
    openingHours: '月・火・水 11:00 - 20:00',
    scheduleSourceUrl: LISTING_URL,
  };
  const payload = toPayload(draft, at);
  assert.equal(
    (payload.reservation as Record<string, unknown>).mode,
    'unavailable',
    '0.1 can still read the record',
  );
  const restaurant = toRestaurant(row(payload))!;
  assert.deepEqual(restaurant.tags, ['寿司', '海鮮', '穴子寿司']);
  assert.deepEqual(restaurant.cuisines, ['japanese.sushi', 'international.seafood']);
  assert.equal(restaurant.openingHours?.value, '月〜水 11:00–20:00');
  assert.deepEqual(restaurant.reservation, { policy: 'not_reservable', label: '予約不可' });
});
