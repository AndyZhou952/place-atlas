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
  assert.equal(
    discovered.ok && discovered.value.replyText,
    'Japan Atlas｜请选择餐厅\n\n' +
      '1. 鮨青空\n' +
      '   地址：東京都中央区銀座\n' +
      '   来源：Google Maps\n\n' +
      '回复：/jpmap add select <编号>',
  );
  assert.equal(
    selected.ok && selected.value.replyText,
    'Japan Atlas｜请确认\n\n' +
      '餐厅：鮨青空\n' +
      '地址：東京都中央区銀座\n' +
      '地图定位：待补充\n' +
      'Tabelog：未找到\n' +
      '预约：未知\n\n' +
      '待补充：地图定位，Tabelog，预约\n\n' +
      '保存：/jpmap add confirm\n' +
      '取消：/jpmap add cancel',
  );
  assert.equal(
    confirmed.ok && confirmed.value.replyText,
    'Japan Atlas｜已保存并加入地图。',
  );
  assert.equal(
    cancelled.ok && cancelled.value.replyText,
    'Japan Atlas｜本次 Add 已取消。',
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

test('Agent confirm conflict returns the compact refreshed preview before another explicit confirm', async () => {
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
    '资料有变化，本次尚未写入',
    '餐厅：鮨青空',
    '地图定位：已确认',
    'Tabelog：4.21 · 321 条评价',
    '预约：Reservation required',
    '可能与已有地点重复：Existing Sushi',
    '部分资料可能已过期',
    '同意新版：/jpmap add confirm',
  ]) {
    assert.match(result.value.replyText, new RegExp(expected, 'u'));
  }
  for (const forbidden of [
    'Preview v4',
    'google_places',
    '35.671',
    '139.765',
    'OpenStreetMap',
    'Tabelog evidence changed.',
    'existing-1',
  ]) {
    assert.equal(result.value.replyText.includes(forbidden), false, forbidden);
  }
  assert.equal(confirmCalls, 1);
});

test('all Add operation failures use the channel presenter without leaking provider messages', async () => {
  for (const [failureKind, expectedKind, expectedMessage] of [
    [
      'unauthorized',
      'invalid_input',
      'Japan Atlas｜Owner 身份未通过验证，本次没有写入。',
    ],
    [
      'forbidden',
      'invalid_input',
      'Japan Atlas｜Owner 身份未通过验证，本次没有写入。',
    ],
    [
      'rate_limited',
      'dependency_failure',
      'Japan Atlas｜添加功能暂时不可用，请稍后重试。',
    ],
    [
      'dependency_failure',
      'dependency_failure',
      'Japan Atlas｜添加功能暂时不可用，请稍后重试。',
    ],
    [
      'invalid_input',
      'invalid_input',
      'Japan Atlas｜Add 输入无效，本次没有写入。请检查命令后重试。',
    ],
    [
      'unexpected_failure',
      'unexpected_failure',
      'Japan Atlas｜Add 请求未能完成，本次没有写入。请稍后重试。',
    ],
  ]) {
    const application = createAtlasApplication(
      createCatalogIntakeOperationGroup({
        async discover() {
          return {
            ok: false,
            error: {
              kind: failureKind,
              code: failureKind,
              message: 'provider secret body must not escape',
            },
          };
        },
        async select() {
          throw new Error('not used');
        },
        async confirm() {
          throw new Error('not used');
        },
        async cancel() {
          throw new Error('not used');
        },
      }),
    );
    const router = createProjectCommandRouter(application, {
      catalogIntakeApplication: application,
      conversationResolver: { async resolve() {} },
    });
    const result = await router.dispatch('/jpmap add 鮨青空', {
      requestToken: `failure-${failureKind}`,
      invocation: {
        ownerId: 'wechat-owner',
        channel: 'openclaw-weixin',
        conversationId: 'owner-dm',
      },
    });

    assert.deepEqual(result, {
      ok: false,
      error: { kind: expectedKind, message: expectedMessage },
    });
  }
});

test('router covers no-candidate, clarification, expiry, failed-no-write, and all commit outcomes', async () => {
  let reference = {
    state: 'candidates_ready',
    sessionId: 'session-variants',
    sessionVersion: 1,
  };
  let selectExpired = false;
  let confirmOutput = {
    status: 'failed_no_write',
    reason: 'transaction',
  };
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup({
      async discover() {
        return {
          ok: true,
          value: {
            status: 'clarification_required',
            sessionId: 'session-variants',
            sessionVersion: 1,
            candidates: [],
            hasMore: false,
            expiresAt: '2026-09-24T12:00:00.000Z',
          },
        };
      },
      async select() {
        if (selectExpired) {
          return {
            ok: false,
            error: {
              kind: 'conflict',
              code: 'expired',
              message: 'internal expiry detail',
            },
          };
        }
        return {
          ok: true,
          value: {
            status: 'clarification_required',
            sessionId: 'session-variants',
            sessionVersion: 2,
            clarification: {
              code: 'missing_area_or_address',
              prompt: '请补充分店或街区。',
              fields: ['area'],
            },
            expiresAt: '2026-09-24T12:00:00.000Z',
          },
        };
      },
      async confirm() {
        return { ok: true, value: confirmOutput };
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
        return reference;
      },
    },
  });
  const context = {
    requestToken: 'variant-1',
    invocation: {
      ownerId: 'wechat-owner',
      channel: 'openclaw-weixin',
      conversationId: 'owner-dm',
    },
  };

  const empty = await router.dispatch('/jpmap add 不存在', context);
  assert.equal(
    empty.ok && empty.value.replyText,
    'Japan Atlas｜没有找到明确候选。请补充分店、街区或完整地址后重新 Add。',
  );

  const clarification = await router.dispatch('/jpmap add select 1', context);
  assert.equal(
    clarification.ok && clarification.value.replyText,
    'Japan Atlas｜需要补充信息\n\n请补充分店或街区。\n\n' +
      '请补充后重新发送 /jpmap add <餐厅名 + 分店或街区>。',
  );

  selectExpired = true;
  const expired = await router.dispatch('/jpmap add select 1', context);
  assert.deepEqual(expired, {
    ok: false,
    error: {
      kind: 'expired',
      message:
        'Japan Atlas｜本次 Add 已过期，没有写入。请重新发送 /jpmap add <餐厅名>。',
    },
  });

  reference = {
    state: 'preview_ready',
    sessionId: 'session-variants',
    sessionVersion: 2,
    previewVersion: 2,
  };
  const outcomes = [
    [
      { status: 'failed_no_write', reason: 'transaction' },
      'Japan Atlas｜本次没有写入。请重新查看 preview 后重试，或发送 /jpmap add cancel。',
    ],
    [
      {
        status: 'committed_verified',
        itemId: 'verified',
        receiptRef: 'hidden-1',
        replayed: false,
      },
      'Japan Atlas｜已保存并加入地图。',
    ],
    [
      {
        status: 'committed_needs_review',
        itemId: 'review',
        receiptRef: 'hidden-2',
        replayed: false,
      },
      'Japan Atlas｜已保存到 Owner 待审核；补全地址或定位后才会进入地图和 Nearby。',
    ],
    [
      {
        status: 'reused_existing',
        itemId: 'existing',
        receiptRef: 'hidden-3',
        replayed: false,
      },
      'Japan Atlas｜已关联已有地点，没有重复建档。',
    ],
  ];
  for (const [output, expected] of outcomes) {
    confirmOutput = output;
    const result = await router.dispatch('/jpmap add confirm', context);
    assert.equal(result.ok && result.value.replyText, expected);
    assert.equal(
      result.ok && result.value.replyText.includes('hidden-'),
      false,
    );
  }
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
