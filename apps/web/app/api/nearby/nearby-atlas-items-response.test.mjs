import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { createCatalogRead } from '../../../product/application/catalog/catalog-read.ts';
import { InMemoryCatalogState } from '../../../product/application/catalog/in-memory-catalog-state.ts';
import { createDecisionOperationGroup } from '../../../product/application/decision/decision-operations.ts';
import { createNearbyRecommendationOperationGroup } from '../../../product/application/decision/agent-nearby-operation.ts';
import { nearbyAtlasItemsResponse } from './nearby-atlas-items-response.ts';

function item(index, overrides = {}) {
  return {
    id: `item-${index}`,
    kind: 'food',
    title: `Title ${index}`,
    area: 'Tokyo',
    address: 'Tokyo address',
    description: `Description ${index}`,
    latitude: 35.68 + index * 0.001,
    longitude: 139.76,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-01',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-01',
    },
    personalState: 'candidate',
    tags: [],
    sources: [],
    ...overrides,
  };
}

function application(items) {
  return createAtlasApplication(
    createDecisionOperationGroup(
      createCatalogRead(new InMemoryCatalogState(), items),
    ),
  );
}

function structuredNearbyApplication(providerOutcome) {
  const canonicalItem = item(99, {
    id: 'sentinel-item',
    title: 'Canonical item',
    address: 'Canonical address',
  });
  return createAtlasApplication(
    createNearbyRecommendationOperationGroup({
      clock: { now: () => new Date('2026-09-21T12:00:00.000Z') },
      routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
      catalog: {
        async list(profile) {
          assert.equal(profile, 'verified_catalog');
          return [canonicalItem];
        },
        async get(id) {
          return id === canonicalItem.id ? canonicalItem : undefined;
        },
      },
      locationResolver: {
        async resolve() {
          throw new Error('resolver must not be called');
        },
      },
      routeProvider: {
        async walking() {
          throw new Error('route provider must not be called');
        },
      },
      entryAccessProvider: {
        async inspectWalkIn() {
          return {
            status: 'unknown',
            warning: 'Unknown.',
            replyText: 'must not cross the HTTP boundary',
            __sentinel: 'walk-in',
          };
        },
        async inspectQueue() {
          return {
            status: 'unknown',
            warning: 'Unknown.',
            latitude: 35.671,
            __sentinel: 'queue',
          };
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
          return {
            manualVisited: true,
            visitCount: 2,
            latestVisitAt: '2026-09-20T12:00:00.000Z',
            personalRating: 4.5,
            longitude: 139.765,
            replyText: 'must not cross the HTTP boundary',
            __sentinel: 'personal-facts',
          };
        },
      },
      mapDeepLink: () => 'https://fixture.invalid/items/sentinel-item',
      nearbyRecommendation: {
        async execute() {
          return { ok: true, value: providerOutcome };
        },
      },
    }),
  );
}

function poisonedAttribution(label) {
  return {
    label,
    url: 'https://fixture.invalid/provider',
    latitude: 35.671,
    replyText: 'must not cross the HTTP boundary',
    __sentinel: `${label}-attribution`,
  };
}

function poisonedProvenance(query) {
  return {
    providerId: 'fixture-provider',
    policyVersion: 'fixture-v1',
    sourceUrl: `https://fixture.invalid/provider?query=${query}`,
    checkedAt: '2026-09-21T12:00:00.000Z',
    longitude: 139.765,
    replyText: 'must not cross the HTTP boundary',
    __sentinel: `${query}-provenance`,
  };
}

test('the Nearby GET adapter defaults to five verified Atlas items', async () => {
  const response = await nearbyAtlasItemsResponse(
    application(Array.from({ length: 6 }, (_, index) => item(index))),
    new URLSearchParams({ lat: '35.68', lon: '139.76' }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).map((candidate) => candidate.id),
    ['item-0', 'item-1', 'item-2', 'item-3', 'item-4'],
  );
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('the Nearby GET adapter never caches request-only success or error responses', async () => {
  const success = await nearbyAtlasItemsResponse(
    {
      async execute() {
        return {
          ok: true,
          value: {
            status: 'unresolved',
            reason: 'not_found',
            warning: 'No matching address was found.',
            provenance: {
              providerId: 'fixture-provider',
              policyVersion: 'fixture-v1',
              sourceUrl: 'https://fixture.invalid/provider',
              checkedAt: '2026-09-21T12:00:00.000Z',
            },
          },
        };
      },
    },
    new URLSearchParams({ locationHint: '銀座' }),
  );
  const invalid = await nearbyAtlasItemsResponse(
    application([]),
    new URLSearchParams({ locationHint: '' }),
  );

  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.equal(invalid.headers.get('cache-control'), 'no-store');
});

test('the Nearby GET adapter maps multilingual location hints to the closed nearby.recommend result', async () => {
  const calls = [];
  const atlasApplication = {
    async execute(operation) {
      calls.push(operation);
      return {
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
            policyVersion: 'fixture-v1',
            sourceUrl: 'https://fixture.invalid/geocoder?query=ginza',
            checkedAt: '2026-09-21T12:00:00.000Z',
          },
        },
      };
    },
  };

  const responses = await Promise.all(
    ['银座', '銀座', 'ginza'].map((locationHint) =>
      nearbyAtlasItemsResponse(
        atlasApplication,
        new URLSearchParams({ locationHint }),
      ),
    ),
  );
  const payloads = await Promise.all(
    responses.map((response) => response.json()),
  );

  assert.deepEqual(
    calls,
    ['银座', '銀座', 'ginza'].map((locationHint) => ({
      key: 'nearby.recommend',
      input: { locationHint },
    })),
  );
  assert.equal(
    responses.every(({ status }) => status === 200),
    true,
  );
  assert.equal(
    payloads.every((payload) => !('replyText' in payload)),
    true,
  );
  assert.equal(
    payloads.every(
      (payload) =>
        !JSON.stringify(payload).includes('latitude') &&
        !JSON.stringify(payload).includes('longitude'),
    ),
    true,
  );
});

test('the Nearby HTTP response strips provider and Personal Memory sentinels for every outcome', async () => {
  const outcomes = [
    {
      status: 'ambiguous',
      candidates: [
        {
          canonicalAddress: '東京都中央区銀座',
          point: { latitude: 35.671, longitude: 139.765 },
          replyText: 'must not cross the HTTP boundary',
          __sentinel: 'ambiguous-candidate',
        },
      ],
      attribution: poisonedAttribution('Ambiguous geocoder'),
      provenance: poisonedProvenance('ambiguous'),
      replyText: 'must not cross the HTTP boundary',
      __sentinel: 'ambiguous-outcome',
    },
    {
      status: 'unresolved',
      reason: 'not_found',
      warning: 'No matching address was found.',
      provenance: poisonedProvenance('unresolved'),
      replyText: 'must not cross the HTTP boundary',
      __sentinel: 'unresolved-outcome',
    },
    {
      status: 'resolved',
      requestedLocation: '银座',
      resolvedLocation: '東京都中央区銀座',
      recommendations: [
        {
          itemId: 'sentinel-item',
          name: 'Provider item name',
          area: 'Ginza',
          address: 'Provider address',
          straightLineDistanceKm: 0.5,
          visited: false,
          route: {
            status: 'fresh',
            durationSeconds: 600,
            distanceMeters: 700,
            checkedAt: '2026-09-21T11:59:00.000Z',
            attribution: poisonedAttribution('Walking routes'),
          },
          replyText: 'must not cross the HTTP boundary',
          __sentinel: 'resolved-candidate',
        },
      ],
      distanceCandidates: [],
      directTransitCandidates: [],
      unavailableRoutes: [],
      attribution: poisonedAttribution('Resolved geocoder'),
      provenance: poisonedProvenance('resolved'),
      replyText: 'must not cross the HTTP boundary',
      __sentinel: 'resolved-outcome',
    },
  ];

  const responses = await Promise.all(
    outcomes.map((outcome) =>
      nearbyAtlasItemsResponse(
        structuredNearbyApplication(outcome),
        new URLSearchParams({ locationHint: '银座' }),
      ),
    ),
  );
  const payloads = await Promise.all(
    responses.map((response) => response.json()),
  );

  assert.deepEqual(
    payloads.map(({ status }) => status),
    ['ambiguous', 'unresolved', 'resolved'],
  );
  for (const [index, payload] of payloads.entries()) {
    assert.equal(responses[index].status, 200);
    assert.doesNotMatch(
      JSON.stringify(payload),
      /latitude|longitude|replyText|__sentinel/u,
    );
  }
  assert.deepEqual(payloads[0].candidates, [
    { canonicalAddress: '東京都中央区銀座' },
  ]);
  assert.deepEqual(payloads[2].recommendations[0].route.source, {
    label: 'Walking routes',
    url: 'https://fixture.invalid/provider',
  });
  assert.deepEqual(payloads[2].recommendations[0].visit, {
    manualVisited: true,
    visitCount: 2,
    latestVisitAt: '2026-09-20T12:00:00.000Z',
    personalRating: 4.5,
  });
});

test('the Nearby GET adapter rejects invalid location hints without executing an operation', async () => {
  const atlasApplication = {
    async execute() {
      throw new Error('must not execute');
    },
  };
  const invalidHints = ['', '   ', 'line one\nline two', 'x'.repeat(1_001)];
  const responses = await Promise.all(
    invalidHints.map((locationHint) =>
      nearbyAtlasItemsResponse(
        atlasApplication,
        new URLSearchParams({ locationHint }),
      ),
    ),
  );

  assert.deepEqual(
    await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: await response.text(),
      })),
    ),
    invalidHints.map(() => ({
      status: 400,
      body: 'A valid locationHint query parameter is required',
    })),
  );
});

test('the Nearby GET adapter preserves limit normalization from one to twenty', async () => {
  const atlasApplication = application(
    Array.from({ length: 21 }, (_, index) => item(index)),
  );
  const limits = ['1', '20', '99', '-3', 'n/a', '0'];
  const responses = await Promise.all(
    limits.map((limit) =>
      nearbyAtlasItemsResponse(
        atlasApplication,
        new URLSearchParams({ lat: '35.68', lon: '139.76', limit }),
      ),
    ),
  );

  assert.deepEqual(
    await Promise.all(
      responses.map(async (response) => (await response.json()).length),
    ),
    [1, 20, 20, 1, 5, 5],
  );
});

test('the Nearby GET adapter rejects missing, invalid, or out-of-range coordinates', async () => {
  const atlasApplication = application([]);
  const invalidQueries = [
    { lon: '139.76' },
    { lat: '35.68' },
    { lat: '', lon: '139.76' },
    { lat: '   ', lon: '139.76' },
    { lat: '35.68', lon: '' },
    { lat: '35.68', lon: '   ' },
    { lat: 'not-a-number', lon: '139.76' },
    { lat: '35.68', lon: 'not-a-number' },
    { lat: '91', lon: '139.76' },
    { lat: '35.68', lon: '181' },
  ];
  const responses = await Promise.all(
    invalidQueries.map((query) =>
      nearbyAtlasItemsResponse(atlasApplication, new URLSearchParams(query)),
    ),
  );

  assert.deepEqual(
    await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: await response.text(),
      })),
    ),
    invalidQueries.map(() => ({
      status: 400,
      body: 'Valid lat and lon query parameters are required',
    })),
  );
});

test('the Nearby GET adapter excludes review candidates even when the full profile is requested', async () => {
  const verified = item(0);
  const needsReview = item(1, {
    id: 'review-item',
    verificationStatus: 'needs_review',
  });
  const state = new InMemoryCatalogState({
    dynamicPayloads: [JSON.stringify(needsReview)],
    overrides: [],
    assessments: [],
    tombstoneIds: [],
    visitCounts: [],
  });
  const atlasApplication = createAtlasApplication(
    createDecisionOperationGroup(createCatalogRead(state, [verified])),
  );

  const baseline = await nearbyAtlasItemsResponse(
    atlasApplication,
    new URLSearchParams({ lat: '35.68', lon: '139.76' }),
  );
  const full = await nearbyAtlasItemsResponse(
    atlasApplication,
    new URLSearchParams({
      lat: '35.68',
      lon: '139.76',
      profile: 'full_merged_catalog',
    }),
  );
  const invalid = await nearbyAtlasItemsResponse(
    atlasApplication,
    new URLSearchParams({
      lat: '35.68',
      lon: '139.76',
      profile: 'needs_review_only',
    }),
  );

  assert.deepEqual(
    (await baseline.json()).map((candidate) => candidate.id),
    [verified.id],
  );
  assert.deepEqual(
    (await full.json()).map((candidate) => candidate.id),
    [verified.id],
  );
  assert.equal(invalid.status, 400);
  assert.equal(await invalid.text(), 'A valid catalog profile is required');
});
