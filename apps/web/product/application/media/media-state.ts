import type { VisitMediaFilters, VisitMediaMetadata } from './visit-media.ts';
import type { AtomicMutationCommit } from '../atlas-application.ts';

export interface VisitMediaContext {
  readonly itemId: string;
  readonly nextDisplayOrder: number;
}

export interface VisitMediaRecordState {
  list(filters: VisitMediaFilters): Promise<readonly VisitMediaMetadata[]>;
  find(id: string): Promise<VisitMediaMetadata | undefined>;
  findByDisplayId(displayId: string): Promise<VisitMediaMetadata | undefined>;
  getVisitContext(visitId: string): Promise<VisitMediaContext | undefined>;
  /** Commits the complete metadata batch atomically, or commits none of it. */
  insert(
    records: readonly VisitMediaMetadata[],
    atomicCommit?: AtomicMutationCommit,
  ): Promise<void>;
  updateCaption(
    id: string,
    caption: string | undefined,
    updatedAt: string,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<VisitMediaMetadata | undefined>;
  updateScore(
    id: string,
    score: number | undefined,
    updatedAt: string,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<VisitMediaMetadata | undefined>;
  /** Removes metadata before returning the object identity needed for cleanup. */
  delete(
    id: string,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<VisitMediaMetadata | undefined>;
}
