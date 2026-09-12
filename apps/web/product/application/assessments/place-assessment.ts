import type { AtlasItem } from '../catalog/atlas-item.ts';

export interface PlaceAssessment {
  readonly itemId: string;
  readonly overallRating?: number;
  readonly isFavorite: boolean;
  readonly manualVisited: boolean;
  readonly summary?: string;
  readonly updatedAt: string;
}

export interface PlaceAssessmentPatch {
  readonly overallRating?: number | null;
  readonly isFavorite?: boolean;
  readonly manualVisited?: boolean;
  readonly summary?: string | null;
}

export interface PlaceAssessmentMutation {
  readonly itemId: string;
  readonly patch: PlaceAssessmentPatch;
}

export interface PlaceAssessmentMutationResult {
  readonly assessment: PlaceAssessment;
  readonly item: AtlasItem;
}
