import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import { createProjectCommandRouter } from '../conversation/project-command-router.ts';
import { createNearbyRecommendationOperationGroup } from './agent-nearby-operation.ts';

test('full nearby outcome reaches the command reply through AtlasApplication', async () => {
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
    verifiedAt: '2026-09-13T11:00:00.000Z',
    tabelog: {
      score: 3.8,
      reviewCount: 120,
      url: 'https://tabelog.com/fixture',
      checkedAt: '2026-09-13T11:30:00.000Z',
    },
    reservation: {
      mode: 'walk-in',
      label: '可直接到店',
      checkedAt: '2026-09-13T11:30:00.000Z',
    },
    personalState: 'visited',
    personalRating: 4.5,
    hasVisited: true,
    tags: [],
    sources: [],
  };
  const application = createAtlasApplication(
    createNearbyRecommendationOperationGroup({
      clock: { now: () => new Date('2026-09-13T12:00:00.000Z') },
      routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
      catalog: {
        async list() {
          return [item];
        },
        async get(id) {
          return id === item.id ? item : undefined;
        },
      },
      locationResolver: {
        async resolve(locationHint) {
          assert.equal(locationHint, '银座 三越前');
          return {
            status: 'resolved',
            location: {
              canonicalAddress: '东京都中央区银座',
              point: { latitude: 35.671, longitude: 139.764 },
            },
            attribution: {
              label: 'Fixture geocoder',
              url: 'https://fixture.invalid/geocoder',
            },
            provenance: {
              providerId: 'fixture-geocoder',
              policyVersion: 'fixture-location-v1',
              sourceUrl: 'https://fixture.invalid/geocoder?query=ginza',
              checkedAt: '2026-09-13T12:00:00.000Z',
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
            checkedAt: '2026-09-13T11:55:00.000Z',
            attribution: {
              label: 'Fixture routes',
              url: 'https://fixture.invalid/routes',
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
        clock: { now: () => new Date('2026-09-13T12:00:00.000Z') },
      },
      personalFacts: {
        async read() {
          return {
            manualVisited: true,
            visitCount: 2,
            latestVisitAt: '2026-08-01',
            personalRating: 4.5,
          };
        },
      },
      mapDeepLink() {
        return 'https://fixture.invalid/items/sushi-1';
      },
    }),
  );

  const result = await createProjectCommandRouter(application).dispatch(
    '/jpmap nearby  银座 三越前 ',
  );

  assert.equal(result.ok, true);
  assert.match(result.value.replyText, /Fixture geocoder/u);
  assert.match(result.value.replyText, /鲜鱼 銀座本店/u);
  assert.match(result.value.replyText, /步行 8 分钟/u);
  assert.match(result.value.replyText, /已到访 · 2 次/u);
  assert.match(result.value.replyText, /外部评分（食べログ）：3.8\/5/u);
  assert.match(result.value.replyText, /到店：未知/u);
});

test('ambiguous and unresolved replies keep request-specific location provenance', async () => {
  const provenance = {
    providerId: 'fixture-geocoder',
    policyVersion: 'fixture-location-v1',
    sourceUrl: 'https://fixture.invalid/geocoder?query=shinjuku',
    checkedAt: '2026-09-13T12:00:00.000Z',
  };
  const resolutions = [
    {
      status: 'ambiguous',
      candidates: [
        {
          canonicalAddress: '東京都新宿区西新宿',
          point: { latitude: 35.69, longitude: 139.69 },
        },
      ],
      attribution: {
        label: 'Fixture geocoder',
        url: 'https://fixture.invalid/docs',
      },
      provenance,
    },
    {
      status: 'unresolved',
      reason: 'not_found',
      warning: 'No matching address was found.',
      provenance,
    },
  ];
  const application = createAtlasApplication(
    createNearbyRecommendationOperationGroup({
      clock: { now: () => new Date('2026-09-13T12:00:00.000Z') },
      routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
      catalog: {
        async list() {
          throw new Error('must not read catalog');
        },
        async get() {
          return undefined;
        },
      },
      locationResolver: {
        async resolve() {
          return resolutions.shift();
        },
      },
      routeProvider: {
        async walking() {
          throw new Error('must not route');
        },
      },
      entryAccessProvider: {
        async inspectWalkIn() {
          throw new Error('must not inspect');
        },
        async inspectQueue() {
          throw new Error('must not inspect');
        },
      },
      entryAccessPolicy: {
        policyVersion: 'entry-v1',
        allowedSourceOrigins: [],
        maximumAgeMs: 5 * 60 * 1000,
        clock: { now: () => new Date('2026-09-13T12:00:00.000Z') },
      },
      personalFacts: {
        async read() {
          return { manualVisited: false, visitCount: 0 };
        },
      },
      mapDeepLink: () => '',
    }),
  );
  const router = createProjectCommandRouter(application);

  const ambiguous = await router.dispatch('/jpmap nearby 新宿');
  const unresolved = await router.dispatch('/jpmap nearby missing');

  assert.equal(ambiguous.ok, true);
  assert.match(ambiguous.value.replyText, /東京都新宿区西新宿/u);
  assert.match(ambiguous.value.replyText, /geocoder\?query=shinjuku/u);
  assert.match(ambiguous.value.replyText, /核验：2026-09-13T12:00:00.000Z/u);
  assert.equal(unresolved.ok, true);
  assert.match(unresolved.value.replyText, /无法确认位置/u);
  assert.match(unresolved.value.replyText, /geocoder\?query=shinjuku/u);
  assert.match(unresolved.value.replyText, /fixture-location-v1/u);
});
