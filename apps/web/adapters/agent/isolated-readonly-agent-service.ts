import type { AtlasItem } from '../../product/application/catalog/atlas-item.ts';
import type { CatalogRead } from '../../product/application/catalog/catalog-read.ts';
import type { AgentNearbyOperationDependencies } from '../../product/application/decision/agent-nearby-operation.ts';
import type { AtlasApplication } from '../../product/application/atlas-application.ts';
import { createAgentServiceGateway } from '../../product/application/conversation/agent-service-gateway.ts';
import {
  createAgentToolCatalog,
  createProjectCommandRouter,
  type NearbyApplicationDefinitions,
} from '../../product/application/conversation/project-command-router.ts';
import { createAgentHttpHandler } from './agent-http-mapping.ts';
import {
  createSingleOwnerAgentKeyStore,
  D1AgentAuditSink,
  D1AgentGatewayState,
} from './d1-agent-gateway-adapters.ts';

interface AgentGatewayBindings {
  readonly DB: D1Database;
  readonly MEDIA: R2Bucket;
  readonly ATLAS_DATASET: string;
  readonly ATLAS_DEPLOYMENT_ENV: string;
  readonly AGENT_JPMAP_KEY_ID: string;
  readonly AGENT_JPMAP_HMAC_SECRET: string;
  readonly AGENT_OWNER_ACTOR_ID: string;
  readonly AGENT_OWNER_CONVERSATION_ID: string;
}

export type OwnerPocAgentBindings = AgentGatewayBindings;

export interface IsolatedReadonlyAgentBindings extends AgentGatewayBindings {
  readonly GOOGLE_MAPS_API_KEY?: string;
}

export function createIsolatedReadonlyAgentHttpHandler(
  bindings: IsolatedReadonlyAgentBindings,
  application: AtlasApplication<NearbyApplicationDefinitions>,
  clock: { readonly nowMs: () => number } = { nowMs: Date.now },
) {
  return createReadonlyAgentHttpHandler(
    bindings,
    application,
    hasSafeIsolatedBindings(bindings),
    clock,
  );
}

export function createOwnerPocAgentHttpHandler(
  bindings: OwnerPocAgentBindings,
  application: AtlasApplication<NearbyApplicationDefinitions>,
  clock: { readonly nowMs: () => number } = { nowMs: Date.now },
) {
  return createReadonlyAgentHttpHandler(
    bindings,
    application,
    hasSafeOwnerPocBindings(bindings),
    clock,
  );
}

function createReadonlyAgentHttpHandler(
  bindings: AgentGatewayBindings,
  application: AtlasApplication<NearbyApplicationDefinitions>,
  safe: boolean,
  clock: { readonly nowMs: () => number },
) {
  if (!safe) return unavailableHandler();
  const gateway = createAgentServiceGateway({
    router: createProjectCommandRouter(application),
    toolCatalog: createAgentToolCatalog(),
    keys: createSingleOwnerAgentKeyStore({
      keyId: bindings.AGENT_JPMAP_KEY_ID,
      secret: bindings.AGENT_JPMAP_HMAC_SECRET,
      actorId: bindings.AGENT_OWNER_ACTOR_ID,
      conversationId: bindings.AGENT_OWNER_CONVERSATION_ID,
    }),
    state: new D1AgentGatewayState(bindings.DB),
    audit: new D1AgentAuditSink(bindings.DB, clock.nowMs),
    clock,
  });
  return createAgentHttpHandler(gateway);
}

function unavailableHandler() {
  return async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          kind: 'dependency_failure',
          message: 'The isolated Japan Atlas PoC is unavailable.',
        },
      }),
      {
        status: 503,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'application/json; charset=utf-8',
        },
      },
    );
}

function hasSafeOwnerPocBindings(bindings: OwnerPocAgentBindings): boolean {
  return (
    bindings.ATLAS_DEPLOYMENT_ENV === 'owner-poc' &&
    bindings.ATLAS_DATASET === 'owner-poc' &&
    hasConfiguredAgentGatewayBindings(bindings)
  );
}

function hasSafeIsolatedBindings(
  bindings: IsolatedReadonlyAgentBindings,
): boolean {
  return (
    bindings.ATLAS_DEPLOYMENT_ENV === 'agent-poc-readonly' &&
    bindings.ATLAS_DATASET === 'fixture' &&
    hasConfiguredAgentGatewayBindings(bindings)
  );
}

function hasConfiguredAgentGatewayBindings(
  bindings: AgentGatewayBindings,
): boolean {
  return (
    Boolean(bindings.DB) &&
    Boolean(bindings.MEDIA) &&
    isConfigured(bindings.AGENT_JPMAP_KEY_ID) &&
    isConfigured(bindings.AGENT_JPMAP_HMAC_SECRET) &&
    isConfigured(bindings.AGENT_OWNER_ACTOR_ID) &&
    isConfigured(bindings.AGENT_OWNER_CONVERSATION_ID)
  );
}
interface NearbyFixtureRow {
  readonly resolved_location: string;
  readonly item_id: string;
  readonly name: string;
  readonly area: string;
  readonly address: string;
  readonly walking_minutes: number;
  readonly visited: number;
  readonly reason: string;
  readonly map_deep_link: string;
}

export function createIsolatedReadonlyNearbyComposition(database: D1Database): {
  readonly catalogRead: CatalogRead;
  readonly agentNearby: Omit<AgentNearbyOperationDependencies, 'catalog'>;
} {
  let fixtureRows: Promise<readonly NearbyFixtureRow[]> | undefined;
  const readRows = () => {
    fixtureRows ??= database
      .prepare(
        `SELECT resolved_location, item_id, name, area, address,
                walking_minutes, visited, reason, map_deep_link
         FROM agent_nearby_fixtures
         WHERE fixture_set = ?
         ORDER BY fixture_rank ASC`,
      )
      .bind('readonly-default')
      .all<NearbyFixtureRow>()
      .then(({ results }) => results);
    return fixtureRows;
  };
  const readItems = async (): Promise<readonly AtlasItem[]> =>
    (await readRows()).map((row, index) => ({
      id: row.item_id,
      kind: 'food',
      title: row.name,
      area: row.area,
      address: row.address,
      description: row.reason,
      latitude: 35.671 + index * 0.0001,
      longitude: 139.765 + index * 0.0001,
      verificationStatus: 'verified',
      verifiedAt: '2026-09-13T00:00:00.000Z',
      officialUrl: row.map_deep_link,
      reservation: {
        mode: 'unknown',
        label: '需确认',
        checkedAt: '2026-09-13T00:00:00.000Z',
      },
      personalState: row.visited ? 'visited' : 'candidate',
      hasVisited: Boolean(row.visited),
      tags: [],
      sources: [],
    }));
  const catalogRead: CatalogRead = {
    async list() {
      return readItems();
    },
    async get(id) {
      return (await readItems()).find((item) => item.id === id);
    },
  };

  return {
    catalogRead,
    agentNearby: {
      clock: { now: () => new Date('2026-09-13T00:02:00.000Z') },
      routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
      locationResolver: {
        async resolve(locationHint) {
          const first = (await readRows())[0];
          if (!first) {
            return {
              status: 'unresolved',
              reason: 'not_found',
              warning: `无法确认位置：${locationHint}`,
            };
          }
          return {
            status: 'resolved',
            location: {
              canonicalAddress: first.resolved_location,
              point: { latitude: 35.671, longitude: 139.764 },
            },
            attribution: {
              label: 'Japan Atlas fixture',
              url: 'https://fixture.invalid/location',
            },
            provenance: {
              providerId: 'japan-atlas-fixture',
              policyVersion: 'agent-poc-location-v1',
              sourceUrl: 'https://fixture.invalid/location?query=fixture',
              checkedAt: '2026-09-13T00:02:00.000Z',
            },
          };
        },
      },
      routeProvider: {
        async walking() {
          const first = (await readRows())[0];
          if (!first) {
            return {
              status: 'unavailable',
              warning: 'Walking route is unavailable.',
            };
          }
          return {
            status: 'fresh',
            durationSeconds: first.walking_minutes * 60,
            distanceMeters: first.walking_minutes * 75,
            checkedAt: '2026-09-13T00:00:00.000Z',
            attribution: {
              label: 'Japan Atlas fixture',
              url: 'https://fixture.invalid/routes',
            },
          };
        },
      },
      entryAccessProvider: {
        async inspectWalkIn() {
          return { status: 'unknown', warning: '需确认是否可以直接到店。' };
        },
        async inspectQueue() {
          return { status: 'unknown', warning: '需确认排队情况。' };
        },
      },
      entryAccessPolicy: {
        policyVersion: 'agent-poc-entry-v1',
        allowedSourceOrigins: ['https://fixture.invalid'],
        maximumAgeMs: 5 * 60 * 1000,
        clock: { now: () => new Date('2026-09-13T00:02:00.000Z') },
      },
      personalFacts: {
        async read(itemId) {
          const item = await catalogRead.get(itemId);
          return {
            manualVisited: item?.hasVisited === true,
            visitCount: item?.hasVisited === true ? 1 : 0,
          };
        },
      },
      mapDeepLink: (item) =>
        item.officialUrl ??
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`,
    },
  };
}

function isConfigured(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !value.startsWith('<')
  );
}
