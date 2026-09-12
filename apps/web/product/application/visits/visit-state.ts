import type { PlaceAssessment } from '../assessments/place-assessment.ts';
import type { AtlasItemOverrideRecord } from '../catalog/catalog-state.ts';
import type { Visit } from './visit.ts';

export interface VisitItemRecordContext {
  readonly itemId: string;
  readonly dynamicPayload?: string;
  readonly override?: AtlasItemOverrideRecord;
  readonly assessment?: PlaceAssessment;
  readonly tombstoned: boolean;
  readonly visitCount: number;
}

export interface VisitMutationContext extends VisitItemRecordContext {
  readonly visit: Visit;
}

export interface CreateVisitRecords {
  readonly visit: Visit;
  readonly assessment?: PlaceAssessment;
}

export interface UpdateVisitRecords {
  readonly visit: Visit;
  readonly assessment?: PlaceAssessment;
}

export interface VisitRecordState {
  list(): Promise<readonly Visit[]>;
  readItemContext(itemId: string): Promise<VisitItemRecordContext>;
  readVisitContext(id: string): Promise<VisitMutationContext | undefined>;
  /** Commits the Visit insert and optional rating side effect atomically. */
  create(records: CreateVisitRecords): Promise<{ readonly inserted: boolean }>;
  /** Commits the Visit edit and optional rating side effect atomically. */
  update(records: UpdateVisitRecords): Promise<void>;
}
