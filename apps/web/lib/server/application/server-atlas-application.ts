import {
  getAtlasDeploymentEnvironment,
  getD1,
  getMediaBucket,
  getRouteSidecarServiceBinding,
} from '@/db';
import { verifiedAtlasItems } from '@/features/atlas/verified-items';
import { createAtlasApplication } from '@/product/application/atlas-application';
import { createPlaceAssessmentOperationGroup } from '@/product/application/assessments/place-assessment-operations';
import { createCatalogOperationGroup } from '@/product/application/catalog/catalog-operations';
import {
  createCatalogIntakeOperationGroup,
  createUnavailableCatalogIntakeModule,
  type CatalogIntakeModule,
} from '@/product/application/catalog-intake/catalog-intake-coordinator';
import {
  createCatalogItemProjection,
  type CatalogItemProjection,
} from '@/product/application/catalog/catalog-item-projection';
import {
  createCatalogRead,
  type CatalogRead,
} from '@/product/application/catalog/catalog-read';
import { createDecisionOperationGroup } from '@/product/application/decision/decision-operations';
import {
  createNearbyRecommendationOperationGroup,
  type NearbyRecommendOperationDependencies,
} from '@/product/application/decision/agent-nearby-operation';
import { createDestructiveOperationGroup } from '@/product/application/destructive/destructive-operations';
import { createImportJobOperationGroup } from '@/product/application/import-jobs/import-job-operations';
import type { ImportJobDependencies } from '@/product/application/import-jobs/import-job-operations';
import {
  createMediaOperationGroup,
  type MediaDependencies,
} from '@/product/application/media/media-operations';
import { createPublicDisplayOperationGroup } from '@/product/application/public-display/public-display-operations';
import { createVisitOperationGroup } from '@/product/application/visits/visit-operations';

import { D1CatalogState } from './d1-catalog-state';
import { D1DestructiveState } from './d1-destructive-state';
import { D1ImportJobState } from './d1-import-job-state';
import { D1PlaceAssessmentState } from './d1-place-assessment-state';
import { D1VisitMediaState } from './media/d1-visit-media-state';
import { R2MediaObjectStore } from './media/r2-media-object-store';
import { D1VisitState } from './d1-visit-state';
import { createOwnerPocComposition } from './owner-poc-composition';

export function createServerAtlasApplication(
  database: D1Database,
  mediaBucket: R2Bucket,
  dependencyOverrides: Partial<ServerAtlasDependencies> = {},
) {
  const dependencies = {
    ...systemServerAtlasDependencies,
    ...dependencyOverrides,
  };
  const catalogState = new D1CatalogState(database);
  const catalogRead =
    dependencies.catalogRead ??
    createCatalogRead(catalogState, verifiedAtlasItems);
  const catalogItemProjection =
    dependencies.catalogItemProjection ??
    createCatalogItemProjection(verifiedAtlasItems);
  const mediaObjects = new R2MediaObjectStore(mediaBucket);
  const assessmentState = new D1PlaceAssessmentState(database);
  const visitState = new D1VisitState(database);
  const mediaState = new D1VisitMediaState(database);
  return createAtlasApplication({
    ...createImportJobOperationGroup(
      new D1ImportJobState(database),
      dependencies,
    ),
    ...createCatalogOperationGroup(catalogRead, {
      state: catalogState,
      clock: dependencies.clock,
    }),
    ...createCatalogIntakeOperationGroup(
      dependencies.catalogIntakeModule ??
        createUnavailableCatalogIntakeModule(),
    ),
    ...createPlaceAssessmentOperationGroup(catalogRead, assessmentState, {
      clock: dependencies.clock,
    }),
    ...createPublicDisplayOperationGroup({
      catalog: catalogRead,
      assessments: assessmentState,
      visits: visitState,
      media: mediaState,
    }),
    ...createDecisionOperationGroup(catalogRead),
    ...createNearbyRecommendationOperationGroup({
      ...dependencies.agentNearby,
      catalog: catalogRead,
    }),
    ...createVisitOperationGroup(
      visitState,
      catalogItemProjection,
      dependencies,
    ),
    ...createDestructiveOperationGroup(
      new D1DestructiveState(database),
      catalogItemProjection,
      mediaObjects,
      { clock: dependencies.clock },
    ),
    ...createMediaOperationGroup(mediaState, mediaObjects, dependencies),
  });
}

export function getServerAtlasApplication() {
  const database = getD1();
  const mediaBucket = getMediaBucket();
  if (getAtlasDeploymentEnvironment() === 'owner-poc') {
    return createServerAtlasApplication(
      database,
      mediaBucket,
      createOwnerPocComposition(database, getRouteSidecarServiceBinding()),
    );
  }
  return createServerAtlasApplication(database, mediaBucket);
}

export interface ServerAtlasDependencies
  extends ImportJobDependencies, MediaDependencies {
  readonly catalogRead?: CatalogRead;
  readonly catalogItemProjection?: CatalogItemProjection;
  readonly catalogIntakeModule?: CatalogIntakeModule;
  readonly agentNearby: Omit<NearbyRecommendOperationDependencies, 'catalog'>;
}

const systemServerAtlasDependencies: ServerAtlasDependencies = {
  agentNearby: {
    clock: { now: () => new Date() },
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    locationResolver: {
      async resolve() {
        return {
          status: 'unresolved',
          reason: 'dependency_failure',
          warning: 'Address lookup is temporarily unavailable.',
        };
      },
    },
    routeProvider: {
      async walking() {
        return {
          status: 'unavailable',
          warning: 'Walking route is temporarily unavailable.',
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
      policyVersion: 'atlas-entry-v1',
      allowedSourceOrigins: [],
      maximumAgeMs: 5 * 60 * 1000,
      clock: { now: () => new Date() },
    },
    personalFacts: {
      async read() {
        return { manualVisited: false, visitCount: 0 };
      },
    },
    mapDeepLink: (item) =>
      item.officialUrl ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`,
  },
  clock: { now: () => new Date().toISOString() },
  idSource: { nextId: () => crypto.randomUUID() },
  async digest(bytes) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      Uint8Array.from(bytes).buffer,
    );
    return [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
  },
};
