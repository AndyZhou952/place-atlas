import type { VisitTarget } from './visit-target.ts';

export interface Visit {
  readonly id: string;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly visitedAt: string;
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewVisit {
  readonly id?: string;
  readonly itemId: string;
  readonly visitedAt: string;
  readonly rating?: number;
  readonly note?: string;
}

export interface VisitUpdate {
  readonly id: string;
  readonly itemId?: string;
  readonly visitedAt: string;
  readonly rating?: number | null;
  readonly note?: string;
}

export interface VisitMutationResult {
  readonly visit: Visit;
  readonly item: VisitTarget;
}
