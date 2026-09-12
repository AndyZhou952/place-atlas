export type ImportStatus =
  | 'queued'
  | 'collecting'
  | 'needs_review'
  | 'completed'
  | 'failed';

export interface ImportJob {
  readonly id: string;
  readonly sourceRef: string;
  readonly creatorName: string;
  readonly platform: string;
  readonly status: ImportStatus;
  readonly discoveredCount: number;
  readonly needsReviewCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly message?: string;
}

export interface NewImportJob {
  readonly sourceRef: string;
  readonly creatorName: string;
  readonly platform?: string;
}
