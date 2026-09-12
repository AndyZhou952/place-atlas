import type { AtlasItem, PersonalState } from './atlas-item.ts';

export interface AtlasItemOverrideRecord {
  readonly itemId: string;
  readonly title: string;
  readonly description: string;
  readonly personalState: PersonalState;
  readonly updatedAt: string;
}

export interface PlaceAssessmentRecord {
  readonly itemId: string;
  readonly overallRating?: number;
  readonly isFavorite: boolean;
  readonly manualVisited: boolean;
}

export interface VisitCountRecord {
  readonly itemId: string;
  readonly count: number;
}

export interface CatalogStateSnapshot {
  readonly dynamicPayloads: readonly string[];
  readonly overrides: readonly AtlasItemOverrideRecord[];
  readonly assessments: readonly PlaceAssessmentRecord[];
  readonly tombstoneIds: readonly string[];
  readonly visitCounts: readonly VisitCountRecord[];
}

export interface CatalogRecordState {
  readSnapshot(): Promise<CatalogStateSnapshot>;
  saveDynamicItem(item: AtlasItem, storedAt: string): Promise<void>;
  saveOverride(override: AtlasItemOverrideRecord): Promise<void>;
}

export interface CatalogSeed {
  readonly items: readonly AtlasItem[];
}
