import assert from 'node:assert/strict';
import test from 'node:test';

import { createGoogleLocationResolver } from './google-location-resolver.ts';

test('Google geocoding maps one valid candidate deterministically through request-only policy fields', async () => {
  const requests = [];
  const resolver = createGoogleLocationResolver({
    gateway: {
      async invoke(request) {
        requests.push(request);
        return {
          ok: true,
          value: {
            providerId: 'google-maps-platform',
            policyVersion: 'google-fixture-v1',
            sourceUrl:
              'https://maps.googleapis.com/maps/api/geocode/json?address=%E9%8A%80%E5%BA%A7',
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
    clock: () => new Date('2026-09-13T12:00:00.000Z'),
  });

  const result = await resolver.resolve('  銀座  ');

  assert.deepEqual(result, {
    status: 'resolved',
    location: {
      canonicalAddress: '東京都中央区銀座',
      point: { latitude: 35.6717, longitude: 139.765 },
    },
    attribution: {
      label: 'Google Maps',
      url: 'https://developers.google.com/maps/documentation',
    },
    provenance: {
      providerId: 'google-maps-platform',
      policyVersion: 'google-fixture-v1',
      sourceUrl:
        'https://maps.googleapis.com/maps/api/geocode/json?address=%E9%8A%80%E5%BA%A7',
      checkedAt: '2026-09-13T12:00:00.000Z',
    },
  });
  assert.notEqual(result.provenance.sourceUrl, result.attribution.url);

  assert.deepEqual(requests, [
    {
      providerId: 'google-maps-platform',
      credentialScope: 'geocoding.read',
      method: 'GET',
      url: 'https://maps.googleapis.com/maps/api/geocode/json?address=%E9%8A%80%E5%BA%A7&region=jp&components=country%3AJP',
      fields: [
        { name: 'formattedAddress', use: 'chat' },
        { name: 'coordinates', use: 'request' },
      ],
      cache: { mode: 'request_only' },
      estimatedCostUsd: 0.005,
    },
  ]);
});
