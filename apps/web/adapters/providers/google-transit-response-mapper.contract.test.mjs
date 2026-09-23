import assert from 'node:assert/strict';
import test from 'node:test';

import {
  directTransit1200Fixture,
  directTransit1201Fixture,
  missingTransitFieldFixture,
  transferTransitFixture,
} from './fixtures/google-transit-response.fixture.mjs';
import { mapGoogleTransitResponse } from './google-transit-response-mapper.ts';

test('Google transit mapper calculates door-to-door duration and direct-line facts from legs and steps', () => {
  const result = mapGoogleTransitResponse(directTransit1200Fixture);

  assert.deepEqual(result, {
    transitLegs: {
      durationSeconds: 1200,
      boardingCount: 1,
      lineIdentities: ['Tokyo Metro|Ginza Line|G'],
      transferCount: 0,
    },
  });
  assert.equal('polyline' in result, false);
  assert.equal('requestedRoutingPreference' in result, false);
});

test('Google transit mapper preserves the 20:01 fact without classifying it as direct', () => {
  assert.deepEqual(mapGoogleTransitResponse(directTransit1201Fixture), {
    transitLegs: {
      durationSeconds: 1201,
      boardingCount: 1,
      lineIdentities: ['Tokyo Metro|Ginza Line|G'],
      transferCount: 0,
    },
  });
});

test('Google transit mapper calculates transfers even when FEWER_TRANSFERS was requested', () => {
  assert.deepEqual(mapGoogleTransitResponse(transferTransitFixture), {
    transitLegs: {
      durationSeconds: 1100,
      boardingCount: 2,
      lineIdentities: [
        'Tokyo Metro|Ginza Line|G',
        'Tokyo Metro|Marunouchi Line|M',
      ],
      transferCount: 1,
    },
  });
});

test('Google transit mapper uses route total duration instead of shorter step sums', () => {
  assert.deepEqual(
    mapGoogleTransitResponse({
      routes: [
        {
          duration: '1201s',
          legs: [
            {
              steps: [
                { travelMode: 'WALK', staticDuration: '60s' },
                {
                  travelMode: 'TRANSIT',
                  staticDuration: '600s',
                  transitDetails: {
                    transitLine: {
                      agencies: [{ name: 'Tokyo Metro' }],
                      name: 'Ginza Line',
                      nameShortCode: 'G',
                    },
                  },
                },
                { travelMode: 'WALK', staticDuration: '60s' },
              ],
            },
          ],
        },
      ],
    }),
    {
      transitLegs: {
        durationSeconds: 1201,
        boardingCount: 1,
        lineIdentities: ['Tokyo Metro|Ginza Line|G'],
        transferCount: 0,
      },
    },
  );
});

test('Google transit mapper fails closed when a required step or line field is absent', () => {
  assert.equal(mapGoogleTransitResponse(missingTransitFieldFixture), undefined);
  assert.equal(
    mapGoogleTransitResponse({
      routes: [
        {
          legs: [
            {
              steps: [
                { travelMode: 'WALK' },
                {
                  travelMode: 'TRANSIT',
                  staticDuration: '600s',
                  transitDetails: {
                    transitLine: { name: 'Ginza Line' },
                  },
                },
              ],
            },
          ],
        },
      ],
    }),
    undefined,
  );
});
