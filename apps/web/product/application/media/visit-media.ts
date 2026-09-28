export interface VisitMedia {
  readonly id: string;
  readonly visitId: string;
  readonly itemId: string;
  readonly originalFilename: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly contentSha256: string;
  readonly caption?: string;
  /** Optional score for this media item; independent of the place score. */
  readonly score?: number;
  readonly displayOrder: number;
  readonly contentUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VisitMediaMetadata extends Omit<VisitMedia, 'contentUrl'> {
  readonly objectKey: string;
  /** Opaque public lookup token; never derived from the internal ID or key. */
  readonly displayId: string;
}

export interface VisitMediaFilters {
  readonly visitId?: string;
  readonly itemId?: string;
}
