import { getD1, getMediaBucket } from '@/db';
import { verifiedAtlasItems } from '@/features/atlas/verified-items';
import { createAtlasApplication } from '@/product/application/atlas-application';
import { createPlaceAssessmentOperationGroup } from '@/product/application/assessments/place-assessment-operations';
import { createCatalogOperationGroup } from '@/product/application/catalog/catalog-operations';
import { createCatalogItemProjection } from '@/product/application/catalog/catalog-item-projection';
import { createCatalogRead } from '@/product/application/catalog/catalog-read';
import { createDecisionOperationGroup } from '@/product/application/decision/decision-operations';
import { createDestructiveOperationGroup } from '@/product/application/destructive/destructive-operations';
import { createImportJobOperationGroup } from '@/product/application/import-jobs/import-job-operations';
import type { ImportJobDependencies } from '@/product/application/import-jobs/import-job-operations';
import {
  createMediaOperationGroup,
  type MediaDependencies,
} from '@/product/application/media/media-operations';
import { createVisitOperationGroup } from '@/product/application/visits/visit-operations';

import { D1CatalogState } from './d1-catalog-state';
import { D1DestructiveState } from './d1-destructive-state';
import { D1ImportJobState } from './d1-import-job-state';
import { D1PlaceAssessmentState } from './d1-place-assessment-state';
import { D1VisitMediaState } from './media/d1-visit-media-state';
import { R2MediaObjectStore } from './media/r2-media-object-store';
import { D1VisitState } from './d1-visit-state';

export function createServerAtlasApplication(
  database: D1Database,
  mediaBucket: R2Bucket,
  dependencies: ServerAtlasDependencies = systemServerAtlasDependencies,
) {
  const catalogState = new D1CatalogState(database);
  const catalogRead = createCatalogRead(catalogState, verifiedAtlasItems);
  const catalogItemProjection = createCatalogItemProjection(verifiedAtlasItems);
  const mediaObjects = new R2MediaObjectStore(mediaBucket);
  return createAtlasApplication({
    ...createImportJobOperationGroup(
      new D1ImportJobState(database),
      dependencies,
    ),
    ...createCatalogOperationGroup(catalogRead, {
      state: catalogState,
      clock: dependencies.clock,
    }),
    ...createPlaceAssessmentOperationGroup(
      catalogRead,
      new D1PlaceAssessmentState(database),
      { clock: dependencies.clock },
    ),
    ...createDecisionOperationGroup(catalogRead),
    ...createVisitOperationGroup(
      new D1VisitState(database),
      catalogItemProjection,
      dependencies,
    ),
    ...createDestructiveOperationGroup(
      new D1DestructiveState(database),
      catalogItemProjection,
      mediaObjects,
      { clock: dependencies.clock },
    ),
    ...createMediaOperationGroup(
      new D1VisitMediaState(database),
      mediaObjects,
      dependencies,
    ),
  });
}

export function getServerAtlasApplication() {
  return createServerAtlasApplication(getD1(), getMediaBucket());
}

interface ServerAtlasDependencies
  extends ImportJobDependencies, MediaDependencies {}

const systemServerAtlasDependencies: ServerAtlasDependencies = {
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
