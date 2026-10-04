import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createNearbyRecommendationOperationGroup } from './agent-nearby-operation.ts';

test('nearby.recommend returns one channel-neutral result from canonical catalog and personal facts', async () => {
  let personalFactsFail = false;
  const item = {
    id: 'sushi-1',
    kind: 'food',
    title: '鲜鱼 銀座本店',
    area: '银座',
    address: '东京都中央区银座 1-2-3',
    description: 'fixture',
    latitude: 35.671,
    longitude: 139.765,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-21T11:00:00.000Z',
    tabelog: {
      score: 3.8,
      reviewCount: 120,
      url: 'https://tabelog.com/fixture',
      checkedAt: '2026-09-21T11:30:00.000Z',
    },
    reservation: {
      mode: 'walk-in',
      label: '可直接到店',
      checkedAt: '2026-09-21T11:30:00.000Z',
    },
    personalState: 'visited',
    personalRating: 4.5,
    hasVisited: true,
    tags: [],
    sources: [],
  };
  const application = createAtlasApplication(
    createNearbyRecommendationOperationGroup({
      clock: { now: () => new Date('2026-09-21T12:00:00.000Z') },
      routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
      catalog: {
        async list(profile) {
          assert.equal(profile, 'verified_catalog');
          return [item];
        },
        async get(id) {
          return id === item.id ? item : undefined;
        },
      },
      locationResolver: {
        async resolve(locationHint) {
          assert.equal(locationHint, '银座');
          return {
            status: 'resolved',
            location: {
              canonicalAddress: '东京都中央区银座',
              point: { latitude: 35.671, longitude: 139.764 },
            },
            attribution: {
              label: 'Fixture geocoder',
              url: 'https://fixture.invalid/geocoder',
              replyText: 'must not cross the operation boundary',
              latitude: 35.671,
              __sentinel: 'location-attribution',
            },
            provenance: {
              providerId: 'fixture-geocoder',
              policyVersion: 'fixture-location-v1',
              sourceUrl: 'https://fixture.invalid/geocoder?query=ginza',
              checkedAt: '2026-09-21T12:00:00.000Z',
              longitude: 139.765,
              replyText: 'must not cross the operation boundary',
              __sentinel: 'location-provenance',
            },
          };
        },
      },
      routeProvider: {
        async walking() {
          return {
            status: 'fresh',
            durationSeconds: 480,
            distanceMeters: 600,
            checkedAt: '2026-09-21T11:59:00.000Z',
            attribution: {
              label: 'Fixture routes',
              url: 'https://fixture.invalid/routes',
              latitude: 35.671,
              replyText: 'must not cross the operation boundary',
              __sentinel: 'route-attribution',
            },
          };
        },
      },
      entryAccessProvider: {
        async inspectWalkIn() {
          return { status: 'unknown', warning: '需到店确认。' };
        },
        async inspectQueue() {
          return { status: 'unknown', warning: '需到店确认。' };
        },
      },
      entryAccessPolicy: {
        policyVersion: 'entry-v1',
        allowedSourceOrigins: ['https://fixture.invalid'],
        maximumAgeMs: 5 * 60 * 1000,
        clock: { now: () => new Date('2026-09-21T12:00:00.000Z') },
      },
      personalFacts: {
        async read(itemId) {
          assert.equal(itemId, item.id);
          if (personalFactsFail) {
            throw new Error('private Personal Memory detail');
          }
          return {
            manualVisited: true,
            visitCount: 2,
            latestVisitAt: '2026-08-01',
            personalRating: 4.5,
            longitude: 139.765,
            replyText: 'must not cross the operation boundary',
            __sentinel: 'personal-facts',
          };
        },
      },
      mapDeepLink() {
        return 'https://fixture.invalid/items/sushi-1';
      },
    }),
  );

  const result = await application.execute({
    key: 'nearby.recommend',
    input: { locationHint: '银座' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'resolved');
  assert.equal(result.value.recommendations.length, 1);
  assert.deepEqual(result.value.attribution, {
    label: 'Fixture geocoder',
    url: 'https://fixture.invalid/geocoder',
  });
  assert.deepEqual(result.value.provenance, {
    providerId: 'fixture-geocoder',
    policyVersion: 'fixture-location-v1',
    sourceUrl: 'https://fixture.invalid/geocoder?query=ginza',
    checkedAt: '2026-09-21T12:00:00.000Z',
  });
  assert.deepEqual(result.value.recommendations[0], {
    itemId: 'sushi-1',
    name: '鲜鱼 銀座本店',
    kind: 'food',
    area: '银座',
    address: '东京都中央区银座 1-2-3',
    straightLineDistanceKm:
      result.value.recommendations[0].straightLineDistanceKm,
    route: {
      mode: 'walking',
      durationMinutes: 8,
      checkedAt: '2026-09-21T11:59:00.000Z',
      source: {
        label: 'Fixture routes',
        url: 'https://fixture.invalid/routes',
      },
    },
    visit: {
      manualVisited: true,
      visitCount: 2,
      latestVisitAt: '2026-08-01',
      personalRating: 4.5,
    },
    entryAccess: {
      walkInAssertion: { status: 'unknown', warning: '需到店确认。' },
      queueAssertion: { status: 'unknown', warning: '需到店确认。' },
    },
    reservation: {
      label: '可直接到店',
      checkedAt: '2026-09-21T11:30:00.000Z',
    },
    externalRating: {
      platform: '食べログ',
      score: 3.8,
      reviewCount: 120,
      sourceUrl: 'https://tabelog.com/fixture',
      checkedAt: '2026-09-21T11:30:00.000Z',
    },
    reason: '步行 15 分钟内可达',
    warnings: [],
    mapDeepLink: 'https://fixture.invalid/items/sushi-1',
  });
  assert.equal('replyText' in result.value, false);
  assert.equal(JSON.stringify(result.value).includes('Japan Atlas｜'), false);
  assert.doesNotMatch(
    JSON.stringify(result.value),
    /latitude|longitude|replyText|__sentinel/u,
  );

  personalFactsFail = true;
  const failed = await application.execute({
    key: 'nearby.recommend',
    input: { locationHint: '银座' },
  });
  assert.deepEqual(failed, {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'Japan Atlas nearby is temporarily unavailable.',
    },
  });
});

test('nearby.recommend closes ambiguous and unresolved provider output', async () => {
  let providerOutcome = {
    status: 'ambiguous',
    candidates: [
      {
        canonicalAddress: '東京都中央区銀座',
        point: { latitude: 35.671, longitude: 139.765 },
        replyText: 'must not cross the operation boundary',
        __sentinel: 'ambiguous-candidate',
      },
    ],
    attribution: {
      label: 'Fixture geocoder',
      url: 'https://fixture.invalid/geocoder',
      latitude: 35.671,
      replyText: 'must not cross the operation boundary',
      __sentinel: 'ambiguous-attribution',
    },
    provenance: {
      providerId: 'fixture-geocoder',
      policyVersion: 'fixture-location-v1',
      sourceUrl: 'https://fixture.invalid/geocoder?query=ginza',
      checkedAt: '2026-09-21T12:00:00.000Z',
      longitude: 139.765,
      replyText: 'must not cross the operation boundary',
      __sentinel: 'ambiguous-provenance',
    },
    replyText: 'must not cross the operation boundary',
    __sentinel: 'ambiguous-outcome',
  };
  const application = createAtlasApplication(
    createNearbyRecommendationOperationGroup({
      clock: { now: () => new Date('2026-09-21T12:00:00.000Z') },
      routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
      catalog: {
        async list() {
          throw new Error('catalog must not be read');
        },
        async get() {
          throw new Error('catalog must not be read');
        },
      },
      locationResolver: {
        async resolve() {
          throw new Error('resolver must not be called');
        },
      },
      routeProvider: {
        async walking() {
          throw new Error('routes must not be called');
        },
      },
      entryAccessProvider: {
        async inspectWalkIn() {
          throw new Error('entry access must not be called');
        },
        async inspectQueue() {
          throw new Error('entry access must not be called');
        },
      },
      entryAccessPolicy: {
        policyVersion: 'entry-v1',
        allowedSourceOrigins: [],
        maximumAgeMs: 5 * 60 * 1000,
        clock: { now: () => new Date('2026-09-21T12:00:00.000Z') },
      },
      personalFacts: {
        async read() {
          throw new Error('Personal Memory must not be read');
        },
      },
      mapDeepLink() {
        throw new Error('deep link must not be built');
      },
      nearbyRecommendation: {
        async execute() {
          return {
            ok: true,
            value: providerOutcome,
          };
        },
      },
    }),
  );

  const result = await application.execute({
    key: 'nearby.recommend',
    input: { locationHint: '銀座' },
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      status: 'ambiguous',
      candidates: [{ canonicalAddress: '東京都中央区銀座' }],
      attribution: {
        label: 'Fixture geocoder',
        url: 'https://fixture.invalid/geocoder',
      },
      provenance: {
        providerId: 'fixture-geocoder',
        policyVersion: 'fixture-location-v1',
        sourceUrl: 'https://fixture.invalid/geocoder?query=ginza',
        checkedAt: '2026-09-21T12:00:00.000Z',
      },
    },
  });
  assert.equal(JSON.stringify(result).includes('latitude'), false);
  assert.equal(JSON.stringify(result).includes('longitude'), false);
  assert.equal(JSON.stringify(result).includes('replyText'), false);
  assert.equal(JSON.stringify(result).includes('__sentinel'), false);

  providerOutcome = {
    status: 'unresolved',
    reason: 'not_found',
    warning: 'No matching address was found.',
    provenance: {
      providerId: 'fixture-geocoder',
      policyVersion: 'fixture-location-v1',
      sourceUrl: 'https://fixture.invalid/geocoder?query=missing',
      checkedAt: '2026-09-21T12:01:00.000Z',
      latitude: 35.671,
      longitude: 139.765,
      replyText: 'must not cross the operation boundary',
      __sentinel: 'unresolved-provenance',
    },
    replyText: 'must not cross the operation boundary',
    __sentinel: 'unresolved-outcome',
  };
  const unresolved = await application.execute({
    key: 'nearby.recommend',
    input: { locationHint: 'missing' },
  });

  assert.deepEqual(unresolved, {
    ok: true,
    value: {
      status: 'unresolved',
      reason: 'not_found',
      warning: 'No matching address was found.',
      provenance: {
        providerId: 'fixture-geocoder',
        policyVersion: 'fixture-location-v1',
        sourceUrl: 'https://fixture.invalid/geocoder?query=missing',
        checkedAt: '2026-09-21T12:01:00.000Z',
      },
    },
  });
  assert.doesNotMatch(
    JSON.stringify(unresolved),
    /latitude|longitude|replyText|__sentinel/u,
  );
});
