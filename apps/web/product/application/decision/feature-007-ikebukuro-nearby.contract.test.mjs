import assert from 'node:assert/strict';
import test from 'node:test';

import { createRouteSidecarNearbyAdapter } from '../../../route-sidecar/route-sidecar-nearby-adapter.ts';
import { createAtlasApplication } from '../atlas-application.ts';
import { createNearbyRecommendationOperationGroup } from './agent-nearby-operation.ts';

const checkedAt = '2026-09-24T09:00:00.000Z';

test('all private Sidecar and Owner failures collapse to the same product dependency outcome', async () => {
  for (const error of [
    'not_configured',
    'credential_rejected',
    'transport_unavailable',
    'upstream_unavailable',
    'malformed_response',
    'binding_missing',
    'quota_exhausted',
    'quota_exceeded',
    'dependency_failure',
  ]) {
    const adapter = createRouteSidecarNearbyAdapter({
      async geocode() {
        return {
          ok: false,
          error,
          providerBody: 'PRIVATE-PROVIDER-BODY',
          locationHint: 'PRIVATE-QUERY-池袋',
        };
      },
      async walkingMatrix() {
        throw new Error('not used');
      },
    });

    assert.deepEqual(await adapter.locationResolver.resolve('池袋'), {
      status: 'unresolved',
      reason: 'dependency_failure',
      warning: 'Address lookup is temporarily unavailable.',
    });
  }
});

test('池袋 resolves through the Sidecar, verified catalog, and Routes matrix to one saved product result', async () => {
  const calls = [];
  const item = verifiedIkebukuroItem();
  const adapter = createRouteSidecarNearbyAdapter({
    async geocode(request) {
      calls.push(['geocode', request]);
      return {
        ok: true,
        evidence: {
          candidates: [
            {
              formattedAddress: '東京都豊島区池袋',
              point: { latitude: 35.7295, longitude: 139.7109 },
            },
          ],
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
          source: {
            providerId: 'google-maps-platform',
            endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
          },
          checkedAt,
        },
      };
    },
    async walkingMatrix(request) {
      calls.push(['walkingMatrix', request]);
      return {
        ok: true,
        evidence: {
          routes: [
            {
              destinationIndex: 0,
              durationSeconds: 420,
              distanceMeters: 510,
            },
          ],
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
          source: {
            providerId: 'google-maps-platform',
            endpoint:
              'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
          },
          checkedAt,
        },
      };
    },
  });
  const application = createAtlasApplication(
    createNearbyRecommendationOperationGroup({
      catalog: {
        async list(profile) {
          assert.equal(profile, 'verified_catalog');
          return [item];
        },
        async get(id) {
          return id === item.id ? item : undefined;
        },
      },
      ...adapter,
      clock: { now: () => new Date(checkedAt) },
      routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
      entryAccessProvider: {
        async inspectWalkIn() {
          return { status: 'unknown', warning: '需到店确认。' };
        },
        async inspectQueue() {
          return { status: 'unknown', warning: '需到店确认。' };
        },
      },
      entryAccessPolicy: {
        policyVersion: 'fixture-v1',
        allowedSourceOrigins: [],
        maximumAgeMs: 5 * 60 * 1000,
        clock: { now: () => new Date(checkedAt) },
      },
      personalFacts: {
        async read() {
          return { manualVisited: false, visitCount: 0 };
        },
      },
      mapDeepLink: ({ id }) => `/atlas/${id}`,
    }),
  );

  const result = await application.execute({
    key: 'nearby.recommend',
    input: { locationHint: '池袋' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'resolved');
  assert.equal(result.value.resolvedLocation, '東京都豊島区池袋');
  assert.deepEqual(
    result.value.recommendations.map(({ itemId, name }) => ({ itemId, name })),
    [{ itemId: 'ikebukuro-saved-1', name: '池袋保存済み食堂' }],
  );
  assert.deepEqual(calls, [
    ['geocode', { locationHint: '池袋' }],
    [
      'walkingMatrix',
      {
        origin: { latitude: 35.7295, longitude: 139.7109 },
        destinations: [{ latitude: 35.733, longitude: 139.711 }],
      },
    ],
  ]);
});

function verifiedIkebukuroItem() {
  return {
    id: 'ikebukuro-saved-1',
    kind: 'food',
    title: '池袋保存済み食堂',
    area: '池袋',
    address: '東京都豊島区池袋2丁目',
    description: 'fixed Feature 007 fixture',
    latitude: 35.733,
    longitude: 139.711,
    verificationStatus: 'verified',
    verifiedAt: checkedAt,
    reservation: { mode: 'unknown', label: '要確認' },
    personalState: 'want_to_go',
    hasVisited: false,
    tags: [],
    sources: [],
  };
}
