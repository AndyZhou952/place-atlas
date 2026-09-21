import type { NearbyRecommendOperationDependencies } from '../../../product/application/decision/agent-nearby-operation.ts';
import { createCatalogItemProjection } from '../../../product/application/catalog/catalog-item-projection.ts';
import {
  createD1OwnerPocCatalogRead,
  createD1OwnerPocPersonalFactsRead,
} from '../../../adapters/agent/d1-owner-poc-catalog.ts';

export function createOwnerPocComposition(database: D1Database) {
  const catalogRead = createD1OwnerPocCatalogRead(database);
  const agentNearby: Omit<NearbyRecommendOperationDependencies, 'catalog'> = {
    clock: { now: () => new Date() },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    locationResolver: {
      async resolve() {
        return {
          status: 'unresolved',
          reason: 'dependency_failure',
          warning: 'Walking route service is not configured.',
        };
      },
    },
    routeProvider: {
      async walking() {
        return {
          status: 'unavailable',
          warning: 'Walking route service is not configured.',
        };
      },
    },
    entryAccessProvider: {
      async inspectWalkIn() {
        return {
          status: 'unknown',
          warning: 'Walk-in status is unavailable.',
        };
      },
      async inspectQueue() {
        return { status: 'unknown', warning: 'Queue status is unavailable.' };
      },
    },
    entryAccessPolicy: {
      policyVersion: 'owner-poc-sidecar-pending-v1',
      allowedSourceOrigins: [],
      maximumAgeMs: 5 * 60 * 1000,
      clock: { now: () => new Date() },
    },
    personalFacts: createD1OwnerPocPersonalFactsRead(database),
    mapDeepLink: (item) =>
      item.officialUrl ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`,
  };

  return {
    catalogRead,
    catalogItemProjection: createCatalogItemProjection([]),
    agentNearby,
  };
}
