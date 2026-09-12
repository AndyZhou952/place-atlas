import type { VisitMediaFilters, VisitMediaMetadata } from './visit-media.ts';

export interface VisitMediaContext {
  readonly itemId: string;
  readonly nextDisplayOrder: number;
}

export interface VisitMediaRecordState {
  list(filters: VisitMediaFilters): Promise<readonly VisitMediaMetadata[]>;
  find(id: string): Promise<VisitMediaMetadata | undefined>;
  getVisitContext(visitId: string): Promise<VisitMediaContext | undefined>;
  /** Commits the complete metadata batch atomically, or commits none of it. */
  insert(records: readonly VisitMediaMetadata[]): Promise<void>;
  updateCaption(
    id: string,
    caption: string | undefined,
    updatedAt: string,
  ): Promise<VisitMediaMetadata | undefined>;
  /** Removes metadata before returning the object identity needed for cleanup. */
  delete(id: string): Promise<VisitMediaMetadata | undefined>;
}
