import { createAgentHttpHandler } from '../../../adapters/agent/agent-http-mapping.ts';
import { createAtlasApplication } from '../atlas-application.ts';
import { createNearbyRecommendationOperationGroup } from '../decision/agent-nearby-operation.ts';
import {
  createAgentServiceGateway,
  InMemoryAgentGatewayState,
} from './agent-service-gateway.ts';
import { createAgentNearbyTestDependencies } from './agent-nearby-test-fixture.mjs';
import { signAgentHttpRequest } from './agent-request-signing.ts';
import {
  createAgentToolCatalog,
  createProjectCommandRouter,
} from './project-command-router.ts';
import { createJpmapPlugin } from '../../../../../packages/openclaw-jpmap/src/index.mjs';

const nowMs = Date.parse('2026-09-22T12:00:00.000Z');
const endpoint = 'https://atlas.test/api/agent/v1/tools';
const keyId = 't08-key';
const secret = 't08-secret-never-log';
const owner = Object.freeze({
  actorId: 'wechat-owner',
  channel: 'openclaw-weixin',
  conversationId: 'owner-dm',
  conversationType: 'direct',
});

export function createT08OwnerPocHarness(options = {}) {
  const audits = [];
  const locationHints = [];
  let modelCalls = 0;
  let workerRequests = 0;
  let identifier = 0;

  const router = {
    dispatch(command) {
      const application = createAtlasApplication(
        createNearbyRecommendationOperationGroup(
          createAgentNearbyTestDependencies({
            async recommend({ locationHint }) {
              locationHints.push(locationHint);
              return { ok: true, value: nearbyFixture(locationHint) };
            },
          }),
        ),
      );
      return createProjectCommandRouter(application).dispatch(command);
    },
  };
  const gateway = createAgentServiceGateway({
    router,
    toolCatalog: createAgentToolCatalog(),
    keys: {
      async find(requestedKeyId) {
        if (requestedKeyId !== keyId) return undefined;
        return {
          keyId,
          projectId: 'jpmap',
          secret,
          active: true,
          owner,
          scopes: options.scopes ?? ['atlas:nearby:read'],
        };
      },
    },
    state: new InMemoryAgentGatewayState(),
    audit: {
      async record(event) {
        audits.push(event);
      },
    },
    clock: { nowMs: () => nowMs },
  });
  const handleWorkerRequest = createAgentHttpHandler(gateway);
  const env = {
    JPMAP_AGENT_ENDPOINT: endpoint,
    JPMAP_AGENT_KEY_ID: keyId,
    JPMAP_AGENT_HMAC_SECRET: secret,
    JPMAP_OWNER_ACTOR_ID: owner.actorId,
    JPMAP_OWNER_CONVERSATION_ID: owner.conversationId,
  };
  const plugin = createJpmapPlugin({
    client: {
      env,
      nowMs: () => nowMs,
      randomUUID: () => `t08-${++identifier}`,
      async fetchImpl(url, init) {
        workerRequests += 1;
        return handleWorkerRequest(new Request(url, init));
      },
    },
  });
  let registration;
  plugin.register({
    registerCommand(command) {
      registration = command;
    },
  });

  async function dispatch(command, context) {
    const match = /^\/jpmap(?:\s+(.*))?$/u.exec(command);
    if (!match || !registration) {
      modelCalls += 1;
      return 'ordinary-model-reply';
    }
    return (
      await registration.handler({
        args: match[1] ?? '',
        senderId: owner.actorId,
        channel: owner.channel,
        channelId: owner.channel,
        isAuthorizedSender: true,
        from: owner.conversationId,
        to: owner.conversationId,
        ...context,
      })
    ).text;
  }

  async function createSignedWorkerRequest(input = {}) {
    const mutationId = input.mutationId ?? `t08-direct-${++identifier}`;
    return signAgentHttpRequest({
      url: endpoint,
      method: 'POST',
      body: {
        version: '1',
        projectId: 'jpmap',
        tool: 'jpmap_nearby',
        mutationId,
        actor: owner,
        input: { locationHint: input.locationHint ?? '银座' },
      },
      keyId,
      secret,
      timestamp: `${Math.floor(nowMs / 1_000)}`,
      nonce: input.nonce ?? `t08-direct-nonce-${identifier}`,
    });
  }

  return {
    audits,
    locationHints,
    get modelCalls() {
      return modelCalls;
    },
    get workerRequests() {
      return workerRequests;
    },
    dispatchOwnerCommand(command) {
      return dispatch(command);
    },
    dispatchSecondAccount(command) {
      return dispatch(command, { senderId: 'second-account' });
    },
    dispatchGroup(command) {
      return dispatch(command, {
        from: 'group-1',
        to: 'group-1',
        messageThreadId: 'group-thread',
      });
    },
    createSignedWorkerRequest,
    handleWorkerRequest,
    async sendSignedWorkerRequest(input) {
      return handleWorkerRequest(await createSignedWorkerRequest(input));
    },
  };
}

function nearbyFixture(locationHint) {
  return {
    requestedLocation: locationHint,
    resolvedLocation: '東京都中央区銀座',
    recommendations: [
      {
        itemId: 'ginza-fixture',
        name: '銀座 テスト食堂',
        area: '銀座',
        address: '東京都中央区銀座 1-1-1',
        walkingMinutes: 8,
        visited: false,
        reason: '歩行可达，而且你还没去过',
        mapDeepLink: 'https://atlas.test/items/ginza-fixture',
      },
    ],
  };
}
