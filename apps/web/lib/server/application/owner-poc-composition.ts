import type { NearbyRecommendOperationDependencies } from '../../../product/application/decision/agent-nearby-operation.ts';
import { createCatalogItemProjection } from '../../../product/application/catalog/catalog-item-projection.ts';
import {
  createD1OwnerPocCatalogRead,
  createD1OwnerPocPersonalFactsRead,
} from '../../../adapters/agent/d1-owner-poc-catalog.ts';
import { createD1MeteredRouteSidecarClient } from '../../../route-sidecar/d1-metered-route-sidecar-client.ts';
import type { RouteSidecarServiceBinding } from '../../../route-sidecar/metered-route-sidecar-client.ts';
import { createRouteSidecarNearbyAdapter } from '../../../route-sidecar/route-sidecar-nearby-adapter.ts';

export function createOwnerPocComposition(
  database: D1Database,
  routeSidecarService?: RouteSidecarServiceBinding,
) {
  const catalogRead = createD1OwnerPocCatalogRead(database);
  const clock = { now: () => new Date() };
  const routeEvidence = createRouteSidecarNearbyAdapter(
    createD1MeteredRouteSidecarClient({
      database,
      service: routeSidecarService,
      clock: clock.now,
    }),
  );
  const agentNearby: Omit<NearbyRecommendOperationDependencies, 'catalog'> = {
    clock,
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    locationResolver: routeEvidence.locationResolver,
    routeProvider: routeEvidence.routeProvider,
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
