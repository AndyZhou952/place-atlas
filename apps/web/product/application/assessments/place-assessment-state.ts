import type { PlaceAssessment } from './place-assessment.ts';
import type { AtomicMutationCommit } from '../atlas-application.ts';

export interface PlaceAssessmentContext {
  readonly assessment?: PlaceAssessment;
  readonly visitCount: number;
}

export interface PlaceAssessmentRecordState {
  read(itemId: string): Promise<PlaceAssessmentContext>;
  save(
    assessment: PlaceAssessment,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<void>;
}
