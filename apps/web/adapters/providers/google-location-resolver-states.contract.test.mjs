import assert from 'node:assert/strict';
import test from 'node:test';

import { createGoogleLocationResolver } from './google-location-resolver.ts';

test('Google geocoding preserves provider order and caps ambiguous candidates at three', async () => {
  const resolver = resolverFor({
    formattedAddress: ['A', 'B', 'C', 'D'],
    coordinates: [
      { latitude: 35.1, longitude: 139.1 },
      { latitude: 35.2, longitude: 139.2 },
      { latitude: 35.3, longitude: 139.3 },
      { latitude: 35.4, longitude: 139.4 },
    ],
    confidence: [0.1, 0.99, 0.5, 1],
  });

  const result = await resolver.resolve('Shinjuku');

  assert.deepEqual(result, {
    provenance: {
      providerId: 'google-maps-platform',
      policyVersion: 'google-fixture-v1',
      sourceUrl: 'https://maps.googleapis.com/maps/api/geocode/json',
      checkedAt: '2026-09-13T12:00:00.000Z',
    },
    status: 'ambiguous',
    candidates: [
      {
        canonicalAddress: 'A',
        point: { latitude: 35.1, longitude: 139.1 },
      },
      {
        canonicalAddress: 'B',
        point: { latitude: 35.2, longitude: 139.2 },
      },
      {
        canonicalAddress: 'C',
        point: { latitude: 35.3, longitude: 139.3 },
      },
    ],
    attribution: googleAttribution,
  });
  assert.equal('confidence' in result, false);
});

test('Google geocoding distinguishes no match from malformed provider data', async () => {
  const notFound = await resolverFor({
    formattedAddress: [],
    coordinates: [],
  }).resolve('missing');
  const malformed = await resolverFor({
    formattedAddress: ['Bad coordinate'],
    coordinates: [{ latitude: 1000, longitude: 139 }],
  }).resolve('broken');

  assert.deepEqual(notFound, {
    status: 'unresolved',
    reason: 'not_found',
    warning: 'No matching address was found.',
    provenance: {
      providerId: 'google-maps-platform',
      policyVersion: 'google-fixture-v1',
      sourceUrl: 'https://maps.googleapis.com/maps/api/geocode/json',
      checkedAt: '2026-09-13T12:00:00.000Z',
    },
  });
  assert.deepEqual(malformed, {
    status: 'unresolved',
    reason: 'dependency_failure',
    warning: 'Address lookup is temporarily unavailable.',
  });
});

const googleAttribution = {
  label: 'Google Maps',
  url: 'https://developers.google.com/maps/documentation',
};

function resolverFor(fields) {
  return createGoogleLocationResolver({
    gateway: {
      async invoke() {
        return {
          ok: true,
          value: {
            providerId: 'google-maps-platform',
            policyVersion: 'google-fixture-v1',
            sourceUrl: 'https://maps.googleapis.com/maps/api/geocode/json',
            fields,
            attribution: googleAttribution,
            cache: { mode: 'request_only' },
          },
        };
      },
    },
    estimatedCostUsd: 0.005,
    clock: () => new Date('2026-09-13T12:00:00.000Z'),
  });
}
