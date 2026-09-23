import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import {
  createAgentToolCatalog,
  createProjectCommandRouter,
} from './project-command-router.ts';
import { createNearbyRecommendationOperationGroup } from '../decision/agent-nearby-operation.ts';
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
        message: '用法：/jpmap nearby <街区或地址>',
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
