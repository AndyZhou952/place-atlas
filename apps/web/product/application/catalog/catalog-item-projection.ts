import type { AtlasItem } from './atlas-item.ts';
import type {
  AtlasItemOverrideRecord,
  PlaceAssessmentRecord,
} from './catalog-state.ts';
import { projectCatalog } from './catalog-projection.ts';

export interface CatalogItemProjectionContext {
  readonly itemId: string;
  readonly dynamicPayload?: string;
  readonly override?: AtlasItemOverrideRecord;
  readonly assessment?: PlaceAssessmentRecord;
  readonly tombstoned: boolean;
  readonly visitCount: number;
}

export interface CatalogItemProjection {
  project(context: CatalogItemProjectionContext): AtlasItem | undefined;
}

/**
 * Adapts the complete Catalog projection to callers that already loaded one
 * item's record context. The Catalog remains the sole owner of merge and
 * effective-visited rules.
 */
export function createCatalogItemProjection(
  seedItems: readonly AtlasItem[],
): CatalogItemProjection {
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
