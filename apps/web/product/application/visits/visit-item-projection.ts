import type { AtlasItem } from '../catalog/atlas-item.ts';
import type { VisitItemRecordContext } from './visit-state.ts';

/** Narrow read seam supplied by the composition root; Catalog owns projection. */
export interface VisitItemProjection {
  project(context: VisitItemRecordContext): AtlasItem | undefined;
}
