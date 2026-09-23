import type { AtlasItem } from '../catalog/atlas-item.ts';
import { projectCatalog } from '../catalog/catalog-projection.ts';
import type { VisitItemRecordContext } from './visit-state.ts';
import type { VisitTarget } from './visit-target.ts';

/** Narrow read seam supplied by the composition root; Catalog owns projection. */
export interface VisitItemProjection {
  project(context: VisitItemRecordContext): VisitTarget | undefined;
}

export function createVisitTargetProjection(
  seedItems: readonly AtlasItem[],
): VisitItemProjection {
  return {
    project(context) {
      return projectCatalog(
        {
          dynamicPayloads: context.dynamicPayload
            ? [context.dynamicPayload]
            : [],
          overrides: context.override ? [context.override] : [],
          assessments: context.assessment ? [context.assessment] : [],
          tombstoneIds: context.tombstoned ? [context.itemId] : [],
          visitCounts: [{ itemId: context.itemId, count: context.visitCount }],
        },
        seedItems,
      ).find((item) => item.id === context.itemId);
    },
  };
}
