import assert from 'node:assert/strict';
import test from 'node:test';

import { googleGeocodingResponseFixture } from './fixtures/google-geocoding-response.fixture.mjs';
import { googleRoutesResponseFixture } from './fixtures/google-routes-response.fixture.mjs';
import {
  mapGoogleGeocodingResponse,
  mapGoogleRoutesResponse,
} from './google-provider-response-mappers.ts';

test('Google geocoding fixture maps only approved address and request coordinates', () => {
  assert.deepEqual(mapGoogleGeocodingResponse(googleGeocodingResponseFixture), {
    formattedAddress: ['東京都中央区銀座', '東京都台東区銀座'],
    coordinates: [
      { latitude: 35.6717, longitude: 139.765 },
      { latitude: 35.71, longitude: 139.8 },
    ],
  });
});

test('Google routes fixture maps duration and distance without geometry', () => {
  const result = mapGoogleRoutesResponse(googleRoutesResponseFixture);

  assert.deepEqual(result, {
    routeDurationSeconds: 840,
    routeDistanceMeters: 950,
  });
  assert.equal('polyline' in result, false);
  assert.equal('encodedPolyline' in result, false);
});

test('Google response mappers fail closed for malformed provider payloads', () => {
  assert.equal(
    mapGoogleGeocodingResponse({
      results: [
        {
          formatted_address: 'bad',
          geometry: { location: { lat: '35', lng: 139 } },
        },
      ],
    }),
    undefined,
  );
  assert.equal(
    mapGoogleRoutesResponse({
      routes: [{ duration: 'soon', distanceMeters: 950 }],
    }),
    undefined,
  );
});
