import type { AtlasItem } from '../catalog/atlas-item.ts';
import type { AtomicMutationCommit } from '../atlas-application.ts';
import type { PlaceAssessment } from '../assessments/place-assessment.ts';
import type { AtlasItemOverrideRecord } from '../catalog/catalog-state.ts';

export interface DestructiveItemContext {
  readonly itemId: string;
  readonly dynamicPayload?: string;
  readonly override?: AtlasItemOverrideRecord;
  readonly assessment?: PlaceAssessment;
  readonly tombstoned: boolean;
  readonly visitCount: number;
  readonly mediaObjectKeys: readonly string[];
}

export interface DestructiveItemProjection {
  project(context: DestructiveItemContext): AtlasItem | undefined;
}

export interface DestructiveRecordState {
  readVisitDeletion(id: string): Promise<DestructiveItemContext | undefined>;
  /** Atomically removes the Visit, legacy row, and its media metadata. */
  commitVisitDeletion(
    id: string,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<void>;
  readItemDeletion(id: string): Promise<DestructiveItemContext>;
  /** Atomically removes all structured item records and writes its tombstone. */
  commitItemDeletion(
    id: string,
    deletedAt: string,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<void>;
}

export interface DestructiveMediaObjects {
  delete(objectKey: string): Promise<void>;
}
