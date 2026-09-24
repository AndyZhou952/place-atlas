import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createOwnerPocAgentHttpHandler } from '../../../adapters/agent/isolated-readonly-agent-service.ts';
import { createAgentHttpHandler } from '../../../adapters/agent/agent-http-mapping.ts';
import {
  createSingleOwnerAgentKeyStore,
  D1AgentAuditSink,
  D1AgentGatewayState,
} from '../../../adapters/agent/d1-agent-gateway-adapters.ts';
import { catalogIntakeResponse } from '../../../app/api/catalog-intake/catalog-intake-response.ts';
import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import {
  createCatalogIntakeModule,
  createCatalogIntakeOperationGroup,
} from '../../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { createCatalogRead } from '../../../product/application/catalog/catalog-read.ts';
import { signAgentHttpRequest } from '../../../product/application/conversation/agent-request-signing.ts';
import { createAgentServiceGateway } from '../../../product/application/conversation/agent-service-gateway.ts';
import {
  createAgentToolCatalog,
  createProjectCommandRouter,
} from '../../../product/application/conversation/project-command-router.ts';
import { createNearbyRecommendationOperationGroup } from '../../../product/application/decision/agent-nearby-operation.ts';
import {
  createOwnerAuth,
  deriveOwnerWebConversationId,
} from '../auth/owner-session.ts';
import { protectOwnerWrite } from '../auth/owner-write-guard.ts';
import { D1AtlasCatalogIntakePublisher } from './d1-atlas-catalog-intake.ts';
import { D1CatalogIntakeState } from './d1-catalog-intake-state.ts';
import { D1CatalogState } from './d1-catalog-state.ts';

const migrationRoot = new URL(
  '../../../../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/',
  import.meta.url,
);
const now = new Date('2026-09-23T12:00:00.000Z');
const ownerSecrets = {
  ATLAS_OWNER_PASSWORD: 'fixture-owner-password',
  ATLAS_OWNER_SESSION_SECRET: 'fixture-owner-session-secret-at-least-32-bytes',
};
const agentSecret = 'fixture-agent-secret-never-log';
const agentActor = {
  actorId: 'owner-wechat',
  channel: 'openclaw-weixin',
  conversationId: 'owner-dm',
  conversationType: 'direct',
};

test('real Owner-cookie Web and signed Agent adapters share D1 intake, recovery, cancel, and verified reads', async () => {
  const sqlite = await migratedDatabase();
  const database = toD1(sqlite);
  const state = new D1CatalogIntakeState(database, { now: () => now });
  const catalog = createCatalogRead(new D1CatalogState(database), []);
  const candidates = new Map();
  let sessionSequence = 0;
  let itemSequence = 0;
  const intake = createCatalogIntakeModule({
    discoveryPort: {
      async discover({ query }) {
        const candidate = candidateFor(query);
        candidates.set(candidate.durableIdentity.placeId, candidate);
        return {
          ok: true,
          value: { candidates: [candidate], hasMore: false },
        };
      },
      async refetch({ placeId }) {
        const candidate = candidates.get(placeId);
        return candidate
          ? { ok: true, value: candidate }
          : {
              ok: false,
              error: { kind: 'not_found', message: 'Candidate not found.' },
            };
      },
    },
    durableGeocoderPort: {
      async propose({ ownerQuery }) {
        if (ownerQuery.includes('Needs Review')) {
          return {
            ok: false,
            error: {
              kind: 'dependency_failure',
              message: 'Durable geocoder unavailable.',
            },
          };
        }
        const agent = ownerQuery.includes('Agent');
        return {
          ok: true,
          value: {
            status: 'resolved',
            normalizedAddress: `東京都中央区${ownerQuery}1-1-1`,
            latitude: agent ? 35.672 : 35.671,
            longitude: agent ? 139.766 : 139.765,
            provider: 'fixture-durable-geocoder',
            sourceUrl: `https://fixture.invalid/geocoder/${encodeURIComponent(ownerQuery)}`,
            license: 'Fixture durable evidence',
            checkedAt: now.toISOString(),
          },
        };
      },
    },
    statePort: state,
    atlasCatalogIntakePort: new D1AtlasCatalogIntakePublisher(database, {
      now: () => now,
      nextId: () => `verified-${++itemSequence}`,
    }),
    clock: { now: () => now },
    idSource: { nextId: () => `session-${++sessionSequence}` },
    catalogRevision: {
      async read() {
        const row = sqlite
          .prepare(
            'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1',
          )
          .get();
        return `catalog-r${String(row.revision_number)}`;
      },
    },
  });
  const application = createAtlasApplication({
    ...createCatalogIntakeOperationGroup(intake),
    ...createNearbyRecommendationOperationGroup(nearbyDependencies(catalog)),
  });

  const ownerAuth = createOwnerAuth(ownerSecrets, { now: () => now });
  const login = await ownerAuth.login(
    webRequest('/api/auth/owner', {
      password: ownerSecrets.ATLAS_OWNER_PASSWORD,
    }),
  );
  assert.equal(login.status, 200);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';', 1)[0];
  const web = createWebRouteHarness(application, ownerAuth, cookie);

  const anonymous = await web.send(
    'catalog.intake.discover',
    { query: 'Anonymous', requestToken: 'anonymous-1' },
    { cookie: undefined },
  );
  assert.equal(anonymous.response.status, 401);

  const webDiscover = await web.send('catalog.intake.discover', {
    query: 'Web Verified',
    requestToken: 'web-discover-1',
  });
  assert.equal(webDiscover.response.status, 200);
  const webCandidate = webDiscover.body;
  const webConversation = webDiscover.response.headers.get(
    'x-atlas-web-conversation-id',
  );
  const webSelect = await web.send(
    'catalog.intake.select',
    {
      sessionId: webCandidate.sessionId,
      expectedSessionVersion: webCandidate.sessionVersion,
      ordinal: 1,
      ownerFields: {},
      requestResearch: false,
    },
    { conversationId: webConversation },
  );
  assert.equal(webSelect.body.status, 'preview_ready');
  const webConfirm = await web.send(
    'catalog.intake.confirm',
    {
      sessionId: webSelect.body.sessionId,
      expectedPreviewVersion: webSelect.body.preview.previewVersion,
    },
    { conversationId: webConversation },
  );
  assert.equal(webConfirm.body.status, 'committed_verified');

  const webCancelDiscover = await web.send('catalog.intake.discover', {
    query: 'Web Cancel',
    requestToken: 'web-cancel-1',
  });
  const webCancelled = await web.send(
    'catalog.intake.cancel',
    {
      sessionId: webCancelDiscover.body.sessionId,
      expectedSessionVersion: webCancelDiscover.body.sessionVersion,
    },
    {
      conversationId: webCancelDiscover.response.headers.get(
        'x-atlas-web-conversation-id',
      ),
    },
  );
  assert.equal(webCancelled.body.status, 'cancelled');

  const reviewDiscover = await web.send('catalog.intake.discover', {
    query: 'Web Needs Review',
    requestToken: 'web-review-1',
  });
  const reviewConversation = reviewDiscover.response.headers.get(
    'x-atlas-web-conversation-id',
  );
  const reviewSelect = await web.send(
    'catalog.intake.select',
    {
      sessionId: reviewDiscover.body.sessionId,
      expectedSessionVersion: reviewDiscover.body.sessionVersion,
      ordinal: 1,
      ownerFields: {},
      requestResearch: false,
    },
    { conversationId: reviewConversation },
  );
  assert.equal(reviewSelect.body.status, 'preview_ready');
  const reviewConfirm = await web.send(
    'catalog.intake.confirm',
    {
      sessionId: reviewSelect.body.sessionId,
      expectedPreviewVersion: reviewSelect.body.preview.previewVersion,
    },
    { conversationId: reviewConversation },
  );
  assert.equal(reviewConfirm.body.status, 'conflict');
  const reviewReconfirm = await web.send(
    'catalog.intake.confirm',
    {
      sessionId: reviewConfirm.body.newPreview.sessionId,
      expectedPreviewVersion: reviewConfirm.body.newPreview.previewVersion,
    },
    { conversationId: reviewConversation },
  );
  assert.equal(reviewReconfirm.body.status, 'committed_needs_review');

  const agent = createAgentHarness(database, application, state);
  const agentDiscover = await agent.send(
    'jpmap_add_discover',
    { query: 'Agent Verified' },
    'agent-discover-1',
    'agent-nonce-1',
  );
  assert.equal(agentDiscover.response.status, 200);
  assert.equal(agentDiscover.body.receipt.result.step, 'candidates');
  const agentSelect = await agent.send(
    'jpmap_add_select',
    { ordinal: 1 },
    'agent-select-1',
    'agent-nonce-2',
  );
  assert.equal(agentSelect.body.receipt.result.step, 'preview');
  const agentConfirm = await agent.send(
    'jpmap_add_confirm',
    {},
    'agent-confirm-1',
    'agent-nonce-3',
  );
  assert.equal(
    agentConfirm.body.receipt.result.intake.status,
    'committed_verified',
  );
  const recovered = await agent.send(
    'jpmap_add_confirm',
    {},
    'agent-confirm-recovery-1',
    'agent-nonce-4',
  );
  assert.equal(recovered.body.receipt.result.intake.replayed, true);

  const agentReviewDiscover = await agent.send(
    'jpmap_add_discover',
    { query: 'Agent Needs Review' },
    'agent-review-discover-1',
    'agent-review-nonce-1',
  );
  assert.equal(agentReviewDiscover.body.receipt.result.step, 'candidates');
  const agentReviewSelect = await agent.send(
    'jpmap_add_select',
    { ordinal: 1 },
    'agent-review-select-1',
    'agent-review-nonce-2',
  );
  assert.equal(agentReviewSelect.body.receipt.result.step, 'preview');
  const agentReviewConfirm = await agent.send(
    'jpmap_add_confirm',
    {},
    'agent-review-confirm-1',
    'agent-review-nonce-3',
  );
  assert.equal(agentReviewConfirm.body.receipt.result.step, 'preview');
  assert.equal(
    agentReviewConfirm.body.receipt.result.intake.status,
    'conflict',
  );
  assert.match(
    agentReviewConfirm.body.receipt.result.replyText,
    /本次没有写入/u,
  );
  const agentReviewReconfirm = await agent.send(
    'jpmap_add_confirm',
    {},
    'agent-review-reconfirm-1',
    'agent-review-nonce-4',
  );
  assert.equal(
    agentReviewReconfirm.body.receipt.result.intake.status,
    'committed_needs_review',
  );

  const transportReplay = await agent.sendSigned(agentConfirm.request);
  assert.equal(transportReplay.response.status, 401);
  const secondAccount = await agent.send(
    'jpmap_add_discover',
    { query: 'Forbidden' },
    'agent-forbidden-1',
    'agent-nonce-5',
    { actor: { ...agentActor, actorId: 'second-account' } },
  );
  assert.equal(secondAccount.response.status, 403);
  const group = await agent.send(
    'jpmap_add_discover',
    { query: 'Forbidden group' },
    'agent-forbidden-2',
    'agent-nonce-6',
    {
      actor: {
        ...agentActor,
        conversationId: 'owner-group',
        conversationType: 'group',
      },
    },
  );
  assert.equal(group.response.status, 403);
  const wrongScopeHandler = createAgentHttpHandler(
    createAgentServiceGateway({
      router: createProjectCommandRouter(application, {
        catalogIntakeApplication: application,
        conversationResolver: state,
      }),
      toolCatalog: createAgentToolCatalog(),
      manifestPhase: 'owner',
      keys: createSingleOwnerAgentKeyStore({
        keyId: 'read-only-key',
        secret: agentSecret,
        actorId: agentActor.actorId,
        conversationId: agentActor.conversationId,
      }),
      state: new D1AgentGatewayState(database),
      audit: new D1AgentAuditSink(database, () => now.getTime()),
      clock: { nowMs: () => now.getTime() },
    }),
  );
  const wrongScopeRequest = await signAgentHttpRequest({
    url: 'https://atlas.example/api/agent/v1/tools',
    method: 'POST',
    body: {
      version: '1',
      projectId: 'jpmap',
      tool: 'jpmap_add_discover',
      mutationId: 'wrong-scope-1',
      actor: agentActor,
      input: { query: 'Wrong Scope' },
    },
    keyId: 'read-only-key',
    secret: agentSecret,
    timestamp: String(now.getTime() / 1_000),
    nonce: 'wrong-scope-nonce-1',
  });
  assert.equal((await wrongScopeHandler(wrongScopeRequest)).status, 403);

  const agentCancelDiscover = await agent.send(
    'jpmap_add_discover',
    { query: 'Agent Cancel' },
    'agent-cancel-discover-1',
    'agent-nonce-7',
  );
  assert.equal(agentCancelDiscover.body.receipt.result.step, 'candidates');
  const agentCancelled = await agent.send(
    'jpmap_add_cancel',
    {},
    'agent-cancel-1',
    'agent-nonce-8',
  );
  assert.equal(agentCancelled.body.receipt.result.step, 'cancelled');

  const verified = await catalog.list('verified_catalog');
  assert.deepEqual(
    new Set(verified.map(({ title }) => title)),
    new Set(['Web Verified', 'Agent Verified']),
  );
  assert.deepEqual(
    new Set(
      (await catalog.list('full_merged_catalog')).map(({ title }) => title),
    ),
    new Set([
      'Web Verified',
      'Agent Verified',
      'Web Needs Review',
      'Agent Needs Review',
    ]),
  );
  const nearby = await application.execute({
    key: 'nearby.recommend',
    input: { locationHint: '銀座' },
  });
  assert.equal(nearby.ok, true);
  assert.deepEqual(
    new Set(nearby.value.recommendations.map(({ name }) => name)),
    new Set(['Web Verified', 'Agent Verified']),
  );
  assert.equal(
    nearby.value.recommendations.some(
      ({ name }) => name === 'Agent Needs Review',
    ),
    false,
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM atlas_items').get().count,
    2,
  );
  assert.equal(
    sqlite
      .prepare('SELECT COUNT(*) AS count FROM catalog_intake_terminal_refs')
      .get().count,
    6,
  );
});

function createWebRouteHarness(application, auth, defaultCookie) {
  return {
    async send(operation, input, options = {}) {
      const cookie = Object.hasOwn(options, 'cookie')
        ? options.cookie
        : defaultCookie;
      const request = webRequest(
        `/api/catalog-intake/${operation.split('.').at(-1)}`,
        { input },
        {
          ...(cookie ? { cookie } : {}),
          ...(options.conversationId
            ? { 'x-atlas-web-conversation-id': options.conversationId }
            : {}),
        },
      );
      const guarded = protectOwnerWrite(auth, async (authorizedRequest) =>
        catalogIntakeResponse({
          application,
          request: authorizedRequest,
          operation,
          serverConversationId: await deriveOwnerWebConversationId(
            authorizedRequest,
            ownerSecrets,
            { now: () => now },
          ),
        }),
      );
      const response = await guarded(request);
      const body = response.headers
        .get('content-type')
        ?.includes('application/json')
        ? await response.json()
        : await response.text();
      return { response, body };
    },
  };
}

function createAgentHarness(database, application, resolver) {
  const handler = createOwnerPocAgentHttpHandler(
    {
      DB: database,
      MEDIA: {
        async get() {
          return null;
        },
        async put() {},
        async delete() {},
      },
      ATLAS_DATASET: 'owner-poc',
      ATLAS_DEPLOYMENT_ENV: 'owner-poc',
      AGENT_JPMAP_KEY_ID: 'fixture-key',
      AGENT_JPMAP_HMAC_SECRET: agentSecret,
      AGENT_OWNER_ACTOR_ID: agentActor.actorId,
      AGENT_OWNER_CONVERSATION_ID: agentActor.conversationId,
    },
    application,
    resolver,
    { nowMs: () => now.getTime() },
  );
  return {
    async send(tool, input, mutationId, nonce, options = {}) {
      const request = await signAgentHttpRequest({
        url: 'https://atlas.example/api/agent/v1/tools',
        method: 'POST',
        body: {
          version: '1',
          projectId: 'jpmap',
          tool,
          mutationId,
          actor: options.actor ?? agentActor,
          input,
        },
        keyId: 'fixture-key',
        secret: agentSecret,
        timestamp: String(now.getTime() / 1_000),
        nonce,
      });
      const replayRequest = request.clone();
      const result = await this.sendSigned(request);
      return { ...result, request: replayRequest };
    },
    async sendSigned(request) {
      const response = await handler(request);
      return { response, body: await response.json() };
    },
  };
}

function candidateFor(query) {
  return {
    durableIdentity: {
      providerNamespace: 'google-places',
      placeId: `place-${query.toLowerCase().replaceAll(' ', '-')}`,
      ordinal: 1,
    },
    transientPresentation: {
      name: query,
      address: `Transient ${query}`,
      attribution: {
        label: 'Google Maps',
        url: 'https://maps.google.com/',
      },
    },
  };
}

function nearbyDependencies(catalog) {
  return {
    clock: { now: () => now },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    catalog,
    locationResolver: {
      async resolve() {
        return {
          status: 'resolved',
          location: {
            canonicalAddress: '東京都中央区銀座',
            point: { latitude: 35.671, longitude: 139.764 },
          },
          attribution: {
            label: 'Fixture geocoder',
            url: 'https://fixture.invalid/geocoder',
          },
          provenance: {
            providerId: 'fixture-geocoder',
            policyVersion: 'fixture-v1',
            sourceUrl: 'https://fixture.invalid/geocoder?query=ginza',
            checkedAt: now.toISOString(),
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
          checkedAt: now.toISOString(),
          attribution: {
            label: 'Fixture routes',
            url: 'https://fixture.invalid/routes',
          },
        };
      },
    },
    entryAccessProvider: {
      async inspectWalkIn() {
        return { status: 'unknown', warning: 'Walk-in status is unavailable.' };
      },
      async inspectQueue() {
        return { status: 'unknown', warning: 'Queue status is unavailable.' };
      },
    },
    entryAccessPolicy: {
      policyVersion: 'fixture-entry-v1',
      allowedSourceOrigins: ['https://fixture.invalid'],
      maximumAgeMs: 5 * 60 * 1000,
      clock: { now: () => now },
    },
    personalFacts: {
      async read() {
        return { manualVisited: false, visitCount: 0 };
      },
    },
    mapDeepLink: (item) =>
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`,
  };
}

function webRequest(path, body, extraHeaders = {}) {
  return new Request(`https://atlas.example${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://atlas.example',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function migratedDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    '0001_owner_poc_schema.sql',
    '0006_catalog_intake_sessions.sql',
    '0008_catalog_intake_publication.sql',
    '0009_catalog_intake_research_allowances.sql',
  ]) {
    sqlite.exec(await readFile(new URL(migration, migrationRoot), 'utf8'));
  }
  return sqlite;
}

function toD1(database) {
  function prepare(sql) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      async run() {
        const result = database.prepare(sql).run(...values);
        return { success: true, meta: { changes: result.changes } };
      },
      async first() {
        return database.prepare(sql).get(...values) ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...values) };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
