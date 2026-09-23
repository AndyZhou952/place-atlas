import type { AtlasItem, AtlasReviewCandidate } from '../catalog/atlas-item.ts';

/** Catalog-owned item shapes that may receive private Owner Visit records. */
export type VisitTarget = AtlasItem | AtlasReviewCandidate;
