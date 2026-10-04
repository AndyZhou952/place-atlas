import assert from 'node:assert/strict';
import test from 'node:test';

import { createGooglePlaceRatingClient } from './google-places-new-client.ts';

const placeId = 'ChIJ1234567890';
const scheduleResponse = (overrides = {}) => ({
  id: placeId,
  displayName: { text: '焼鳥 にしき' },
  formattedAddress: '東京都文京区湯島3-36-12',
  googleMapsUri: 'https://maps.google.com/?cid=123456789',
  regularOpeningHours: {
    weekdayDescriptions: [
      '月曜日: 午後6時～午後10時30分',
      '火曜日: 定休日',
      '水曜日: 午後6時～午後10時30分',
    ],
  },
  ...overrides,
});

function client({
  response = scheduleResponse(),
  reserve = async () => 'reserved',
  fetch,
} = {}) {
  return createGooglePlaceRatingClient({
    apiKey: 'fixture-secret',
    usage: { reserve },
    fetch: fetch ?? (async () => Response.json(response)),
  });
}

test('Google operating schedule returns the exact place schedule and explicit closed weekday', async () => {
  const requests = [];
  const result = await client({
    fetch: async (url, init) => {
      requests.push({ url, init });
      return Response.json(scheduleResponse());
    },
  }).getOperatingSchedule(placeId);

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    name: '焼鳥 にしき',
    address: '東京都文京区湯島3-36-12',
    sourceUrl: 'https://maps.google.com/?cid=123456789',
    openingHours:
      '月曜日: 午後6時～午後10時30分\n火曜日: 定休日\n水曜日: 午後6時～午後10時30分',
    regularClosingDays: '火曜日: 定休日',
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    `https://places.googleapis.com/v1/places/${placeId}?languageCode=ja`,
  );
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(
    requests[0].init.headers['X-Goog-FieldMask'],
    'id,displayName,formattedAddress,googleMapsUri,regularOpeningHours.weekdayDescriptions',
  );
});

test('Google operating schedule rejects a mismatched Place ID and invalid schedule payloads', async () => {
  for (const response of [
    scheduleResponse({ id: 'another-branch' }),
    scheduleResponse({ regularOpeningHours: { weekdayDescriptions: [] } }),
    scheduleResponse({
      regularOpeningHours: {
        weekdayDescriptions: Array(8).fill('月曜日: 営業'),
      },
    }),
    scheduleResponse({
      regularOpeningHours: { weekdayDescriptions: ['x'.repeat(171)] },
    }),
    scheduleResponse({ googleMapsUri: 'https://evil.example/place' }),
  ]) {
    const result = await client({ response }).getOperatingSchedule(placeId);
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'dependency_failure');
  }
});

test('Google operating schedule returns unavailable when its provider budget is exhausted', async () => {
  let fetchCalls = 0;
  let reservation;
  const result = await client({
    reserve: async (input) => {
      reservation = input;
      return 'quota_exceeded';
    },
    fetch: async () => {
      fetchCalls++;
      return Response.json(scheduleResponse());
    },
  }).getOperatingSchedule(placeId);

  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'dependency_failure');
  assert.equal(reservation.sku, 'places.details_rating.requests');
  assert.equal(reservation.costUsd, 0.02);
  assert.equal(fetchCalls, 0);
});
