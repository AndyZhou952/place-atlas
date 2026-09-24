import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import {
  createAgentToolCatalog,
  createProjectCommandRouter,
} from './project-command-router.ts';
import { createNearbyRecommendationOperationGroup } from '../decision/agent-nearby-operation.ts';
import { createCatalogIntakeOperationGroup } from '../catalog-intake/catalog-intake-coordinator.ts';
import { createAgentNearbyTestDependencies } from './agent-nearby-test-fixture.mjs';

function nearbyFixture(overrides = {}) {
  return {
    requestedLocation: '银座',
    resolvedLocation: '东京都中央区银座',
    recommendations: [
      {
        itemId: 'sushi-1',
        name: '鲜鱼 銀座本店',
        area: '银座',
        address: '东京都中央区银座 1-2-3',
        walkingMinutes: 8,
        visited: false,
        reason: '步行可达，而且你还没去过',
        mapDeepLink: 'https://atlas.example/items/sushi-1',
      },
    ],
    ...overrides,
  };
}

function createFixtureRouter(provider) {
  const application = createAtlasApplication(
    createNearbyRecommendationOperationGroup(
      createAgentNearbyTestDependencies(provider),
    ),
  );
  return createProjectCommandRouter(application);
}

test('canonical /jpmap nearby traverses AtlasApplication and returns stable WeChat text', async () => {
  const received = [];
  const router = createFixtureRouter({
    async recommend(input) {
      received.push(input);
      return {
        ok: true,
        value: nearbyFixture({ requestedLocation: input.locationHint }),
      };
    },
  });

  const result = await router.dispatch('/jpmap nearby  银座 三越前 ');

  assert.deepEqual(received, [{ locationHint: '银座 三越前' }]);
  assert.equal(result.ok, true);
  assert.equal(result.value.projectId, 'jpmap');
  assert.equal(result.value.operation, 'nearby');
  assert.match(result.value.replyText, /位置来源：Test location/u);
  assert.match(result.value.replyText, /鲜鱼 銀座本店/u);
  assert.match(result.value.replyText, /路线：步行 8 分钟/u);
  assert.match(result.value.replyText, /到访：未到访 · 0 次/u);
  assert.match(
    result.value.replyText,
    /地图：https:\/\/atlas\.example\/items\/sushi-1/u,
  );
});

test('read phase exposes only the nearby tool and no write or destructive operation', () => {
  assert.deepEqual(createAgentToolCatalog().manifest('jpmap', 'read'), {
    service: 'Japan Atlas',
    version: '2026-09-13',
    projectId: 'jpmap',
    phase: 'read',
    tools: [
      {
        name: 'jpmap_nearby',
        operation: 'nearby.recommend',
        effect: 'read',
        requiredScope: 'atlas:nearby:read',
        confirmation: 'none',
        retry: 'safe',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['locationHint'],
          properties: {
            locationHint: { type: 'string', minLength: 1 },
          },
        },
      },
    ],
  });
});

test('Owner intake phase adds only the four reviewed catalog intake operations', () => {
  const manifest = createAgentToolCatalog().manifest('jpmap', 'owner');

  assert.deepEqual(
    manifest.tools.map((tool) => [
      tool.name,
      tool.operation,
      tool.effect,
      tool.requiredScope,
    ]),
    [
      ['jpmap_nearby', 'nearby.recommend', 'read', 'atlas:nearby:read'],
      [
        'jpmap_add_discover',
        'catalog.intake.discover',
        'write',
        'atlas:intake:write',
      ],
      [
        'jpmap_add_select',
        'catalog.intake.select',
        'write',
        'atlas:intake:write',
      ],
      [
        'jpmap_add_confirm',
        'catalog.intake.confirm',
        'write',
        'atlas:intake:write',
      ],
      [
        'jpmap_add_cancel',
        'catalog.intake.cancel',
        'write',
        'atlas:intake:write',
      ],
    ],
  );
  assert.equal(
    manifest.tools.some((tool) =>
      /delete|record|save|update/u.test(tool.operation),
    ),
    false,
  );
});

test('deterministic /jpmap add commands traverse the four shared intake operations', async () => {
  const calls = [];
  let conversationState;
  const application = createAtlasApplication({
    ...createNearbyRecommendationOperationGroup(
      createAgentNearbyTestDependencies({
        async recommend(input) {
          return { ok: true, value: nearbyFixture(input) };
        },
      }),
    ),
    ...createCatalogIntakeOperationGroup({
      async discover(input, scope) {
        calls.push(['discover', input, scope]);
        conversationState = {
          state: 'candidates_ready',
          sessionId: 'session-1',
          sessionVersion: 1,
        };
        return {
          ok: true,
          value: {
            status: 'candidates_ready',
            sessionId: 'session-1',
            sessionVersion: 1,
            candidates: [
              {
                ordinal: 1,
                transientName: '鮨青空',
                transientAddress: '東京都中央区銀座',
                attribution: {
                  label: 'Google Maps',
                  url: 'https://maps.google.com/',
                },
              },
            ],
            hasMore: false,
            expiresAt: '2026-09-23T12:30:00.000Z',
          },
        };
      },
      async select(input, scope) {
        calls.push(['select', input, scope]);
        conversationState = {
          state: 'preview_ready',
          sessionId: 'session-1',
          sessionVersion: 2,
          previewVersion: 2,
        };
        return { ok: true, value: previewOutput() };
      },
      async confirm(input, scope) {
        calls.push(['confirm', input, scope]);
        conversationState = {
          state: 'committed',
          sessionId: 'session-1',
          sessionVersion: 3,
          previewVersion: 2,
        };
        return {
          ok: true,
          value: {
            status: 'committed_verified',
            itemId: 'item-1',
            receiptRef: 'receipt-1',
            replayed: false,
          },
        };
      },
      async cancel(input, scope) {
        calls.push(['cancel', input, scope]);
        const replayed = conversationState?.state === 'cancelled';
        conversationState = {
          state: 'cancelled',
          sessionId: input.sessionId,
          sessionVersion: input.expectedSessionVersion,
        };
        return {
          ok: true,
          value: {
            status: 'cancelled',
            sessionId: input.sessionId,
            replayed,
          },
        };
      },
    }),
  });
  const router = createProjectCommandRouter(application, {
    catalogIntakeApplication: application,
    conversationResolver: {
      async resolve() {
        return conversationState;
      },
    },
  });
  const context = {
    requestToken: 'wechat-event-1',
    invocation: {
      ownerId: 'wechat-owner',
      channel: 'openclaw-weixin',
      conversationId: 'owner-dm',
    },
  };

  const discovered = await router.dispatch('/jpmap add 鮨青空', context);
  const selected = await router.dispatch('/jpmap add select 1', context);
  const confirmed = await router.dispatch('/jpmap add confirm', context);
  const recovered = await router.dispatch('/jpmap add confirm', context);
  const secondContext = { ...context, requestToken: 'wechat-event-2' };
  await router.dispatch('/jpmap add Tempura Kondo', secondContext);
  const cancelled = await router.dispatch('/jpmap add cancel', secondContext);
  const cancelledReplay = await router.dispatch(
    '/jpmap add cancel',
    secondContext,
  );

  assert.equal(discovered.ok && discovered.value.step, 'candidates');
  assert.equal(selected.ok && selected.value.step, 'preview');
  assert.equal(confirmed.ok && confirmed.value.step, 'committed');
  assert.equal(recovered.ok && recovered.value.step, 'committed');
  assert.equal(cancelled.ok && cancelled.value.step, 'cancelled');
  assert.equal(
    cancelledReplay.ok && cancelledReplay.value.intake.replayed,
    true,
  );
  assert.deepEqual(
    calls.map(([operation, input]) => [operation, input]),
    [
      ['discover', { query: '鮨青空', requestToken: 'wechat-event-1' }],
      [
        'select',
        {
          sessionId: 'session-1',
          expectedSessionVersion: 1,
          ordinal: 1,
          ownerFields: {},
          requestResearch: true,
        },
      ],
      ['confirm', { sessionId: 'session-1', expectedPreviewVersion: 2 }],
      ['confirm', { sessionId: 'session-1', expectedPreviewVersion: 2 }],
      ['discover', { query: 'Tempura Kondo', requestToken: 'wechat-event-2' }],
      ['cancel', { sessionId: 'session-1', expectedSessionVersion: 1 }],
      ['cancel', { sessionId: 'session-1', expectedSessionVersion: 1 }],
    ],
  );
  assert.deepEqual(
    calls.map(([, , scope]) => scope),
    Array.from({ length: 7 }, () => context.invocation),
  );
});

test('Agent confirm conflict returns the complete refreshed preview before another explicit confirm', async () => {
  const refreshed = richPreview();
  let confirmCalls = 0;
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup({
      async discover() {
        throw new Error('not used');
      },
      async select() {
        throw new Error('not used');
      },
      async confirm() {
        confirmCalls += 1;
        return {
          ok: true,
          value: { status: 'conflict', newPreview: refreshed },
        };
      },
      async cancel() {
        throw new Error('not used');
      },
    }),
  );
  const router = createProjectCommandRouter(application, {
    catalogIntakeApplication: application,
    conversationResolver: {
      async resolve() {
        return {
          state: 'preview_ready',
          sessionId: refreshed.sessionId,
          sessionVersion: 4,
          previewVersion: refreshed.previewVersion - 1,
        };
      },
    },
  });
  const result = await router.dispatch('/jpmap add confirm', {
    requestToken: 'confirm-conflict-1',
    invocation: {
      ownerId: 'wechat-owner',
      channel: 'openclaw-weixin',
      conversationId: 'owner-dm',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.step, 'preview');
  for (const expected of [
    '本次没有写入',
    'Preview v4',
    '4.21 · 321 reviews',
    'Reservation required',
    'Possible duplicate',
    'Warning: Tabelog evidence changed.',
    '再次发送 /jpmap add confirm',
  ]) {
    assert.match(result.value.replyText, new RegExp(expected, 'u'));
  }
  assert.equal(confirmCalls, 1);
});

function previewOutput() {
  return {
    status: 'preview_ready',
    sessionId: 'session-1',
    sessionVersion: 2,
    expiresAt: '2026-09-23T12:30:00.000Z',
    preview: {
      sessionId: 'session-1',
      previewVersion: 2,
      state: 'preview_ready',
      candidateIdentity: {
        providerNamespace: 'google_places',
        placeId: 'place-1',
      },
      ownerFields: {},
      titleProposal: { provenance: 'owner_query', value: '鮨青空' },
      addressProposal: {
        provenance: 'durable_geocoder_observed',
        value: '東京都中央区銀座',
        sourceUrl: 'https://www.openstreetmap.org/node/1',
        license: 'OpenStreetMap contributors, ODbL 1.0',
        checkedAt: '2026-09-23T12:00:00.000Z',
      },
      locationEvidence: { status: 'unknown' },
      tabelog: { status: 'unknown' },
      reservation: { status: 'unknown' },
      suspectedDuplicates: [],
      unknownFields: ['coordinates', 'tabelog', 'reservation'],
      warnings: [],
      evidenceDigest: 'a'.repeat(64),
      catalogRevision: 'revision-1',
      expiresAt: '2026-09-23T12:30:00.000Z',
    },
  };
}

function richPreview() {
  return {
    ...previewOutput().preview,
    previewVersion: 4,
    titleProposal: {
      provenance: 'agent_observed',
      value: '鮨青空',
      sourceUrl: 'https://restaurant.example/name',
      observedAt: '2026-09-23T12:00:00.000Z',
    },
    locationEvidence: {
      status: 'known',
      provenance: 'durable_geocoder_observed',
      normalizedAddress: '東京都中央区銀座1-1-1',
      latitude: 35.671,
      longitude: 139.765,
      provider: 'Nominatim',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-23T12:01:00.000Z',
    },
    tabelog: {
      status: 'known',
      score: 4.21,
      reviewCount: 321,
      url: 'https://tabelog.com/tokyo/A1301/A130101/13000001/',
      provenance: 'agent_observed',
      observedAt: '2026-09-23T12:02:00.000Z',
      freshness: 'stale',
    },
    reservation: {
      status: 'known',
      mode: 'reservation_required',
      label: 'Reservation required',
      advanceDays: 30,
      url: 'https://restaurant.example/reservations',
      provenance: 'agent_observed',
      observedAt: '2026-09-23T12:03:00.000Z',
      freshness: 'fresh',
    },
    suspectedDuplicates: [
      {
        itemId: 'existing-1',
        title: 'Existing Sushi',
        address: '東京都中央区銀座1-1-2',
        match: 'strong',
      },
    ],
    unknownFields: [],
    warnings: [
      { code: 'stale_evidence', message: 'Tabelog evidence changed.' },
    ],
    evidenceDigest: 'b'.repeat(64),
  };
}

test('invalid nearby commands return one stable help reply without invoking AtlasApplication', async () => {
  let calls = 0;
  const router = createFixtureRouter({
    async recommend() {
      calls += 1;
      return { ok: true, value: nearbyFixture() };
    },
  });
  const invalidCommands = [
    '/jpmap nearby',
    '/jpmap Nearby 银座',
    '/jpmap nearby    ',
    '/jpmap unknown 银座',
    '/JPMAP nearby 银座',
    'jpmap nearby 银座',
  ];

  for (const command of invalidCommands) {
    assert.deepEqual(await router.dispatch(command), {
      ok: false,
      error: {
        kind: 'invalid_input',
        message:
          '用法：\n/jpmap nearby <街区或地址>\n/jpmap add <餐厅名或地址>\n/jpmap add select <1-3>\n/jpmap add confirm\n/jpmap add cancel',
      },
    });
  }
  assert.equal(calls, 0);
});

test('empty recommendations and dependency failure have stable, private WeChat replies', async () => {
  const emptyRouter = createFixtureRouter({
    async recommend() {
      return { ok: true, value: nearbyFixture({ recommendations: [] }) };
    },
  });
  const failedRouter = createFixtureRouter({
    async recommend() {
      throw new Error('provider body and secret must not escape');
    },
  });

  assert.deepEqual(await emptyRouter.dispatch('/jpmap nearby 银座'), {
    ok: true,
    value: {
      projectId: 'jpmap',
      operation: 'nearby',
      nearby: {
        status: 'resolved',
        requestedLocation: '银座',
        resolvedLocation: '东京都中央区银座',
        recommendations: [],
        attribution: {
          label: 'Test location',
          url: 'https://fixture.invalid/location',
        },
        provenance: {
          providerId: 'test-location',
          policyVersion: 'test-location-v1',
          sourceUrl: 'https://fixture.invalid/location?query=fixture',
          checkedAt: '2026-09-13T00:02:00.000Z',
        },
      },
      replyText:
        '位置来源：Test location · 查询：https://fixture.invalid/location?query=fixture · 核验：2026-09-13T00:02:00.000Z · 策略：test-location/test-location-v1\n' +
        'Japan Atlas｜附近推荐：东京都中央区银座\n暂时没有找到符合条件的地点。',
    },
  });
  assert.deepEqual(await failedRouter.dispatch('/jpmap nearby 银座'), {
    ok: false,
    error: {
      kind: 'dependency_failure',
      message: 'Japan Atlas 附近查询暂时不可用，请稍后重试。',
    },
  });
});
