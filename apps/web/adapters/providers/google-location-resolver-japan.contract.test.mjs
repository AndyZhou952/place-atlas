import assert from 'node:assert/strict';
import test from 'node:test';

import { googleLocationHintJapanFixture } from './fixtures/google-location-hint-japan.fixture.mjs';
import { createGoogleLocationResolver } from './google-location-resolver.ts';

test('Google resolver sends Chinese, Japanese, and English Location Hints with Japan bias and restriction', async () => {
  const urls = [];
  const resolver = createGoogleLocationResolver({
    gateway: {
      async invoke(request) {
        urls.push(request.url);
        return {
          ok: true,
          value: {
            providerId: 'google-maps-platform',
            policyVersion: 'google-fixture-v1',
            sourceUrl: request.url,
            fields: {
              formattedAddress: ['東京都中央区銀座'],
              coordinates: [{ latitude: 35.6717, longitude: 139.765 }],
            },
            attribution: {
              label: 'Google Maps',
              url: 'https://developers.google.com/maps/documentation',
            },
            cache: { mode: 'request_only' },
          },
        };
      },
    },
    estimatedCostUsd: 0.005,
    clock: () => new Date('2026-09-15T12:00:00.000Z'),
  });

  const results = await Promise.all(
    googleLocationHintJapanFixture.map(({ hint }) => resolver.resolve(hint)),
  );

  assert.deepEqual(
    urls,
    googleLocationHintJapanFixture.map(
      ({ encoded }) =>
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&region=jp&components=country%3AJP`,
    ),
  );
  assert.deepEqual(
    results.map((result) =>
      result.status === 'resolved'
        ? [result.location.canonicalAddress, result.location.point]
        : result.status,
    ),
    googleLocationHintJapanFixture.map(() => [
      '東京都中央区銀座',
      { latitude: 35.6717, longitude: 139.765 },
    ]),
  );
});
