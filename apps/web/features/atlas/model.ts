export type AtlasItemKind = 'food' | 'event' | 'architecture';
export type AtlasView = 'map' | 'inbox' | 'journal';
export type AtlasKindFilter = 'all' | AtlasItemKind;
export type AtlasPersonalFilter = 'all' | 'unvisited' | 'visited';
export type PersonalState = 'candidate' | 'saved' | 'planned' | 'visited';
export type VerificationStatus = 'verified' | 'needs_review';

export type ReservationMode =
  | 'walk-in'
  | 'same-day'
  | 'advance'
  | 'ticketed'
  | 'unavailable'
  | 'unknown';

export interface SourceLink {
  readonly label: string;
  readonly url: string;
  readonly role: 'official' | 'tabelog' | 'reservation' | 'discovery';
}

export interface TabelogSnapshot {
  readonly score: number;
  readonly reviewCount?: number;
  readonly url: string;
  readonly checkedAt: string;
}

export interface ReservationSnapshot {
  readonly mode: ReservationMode;
  readonly label: string;
  readonly channel?: string;
  readonly url?: string;
  readonly advanceDays?: number;
  readonly bookingWindowLabel?: string;
  readonly releaseNote?: string;
  readonly checkedAt: string;
}

export interface EventSchedule {
  readonly startDate: string;
  readonly endDate: string;
  readonly displayDate: string;
}

export interface AtlasItem {
  readonly id: string;
  readonly kind: AtlasItemKind;
  readonly title: string;
  readonly alternateTitle?: string;
  readonly area: string;
  readonly address: string;
  readonly description: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly verificationStatus: VerificationStatus;
  readonly verifiedAt: string;
  readonly officialUrl?: string;
  readonly tabelog?: TabelogSnapshot;
  readonly reservation: ReservationSnapshot;
  readonly event?: EventSchedule;
  readonly personalState: PersonalState;
  readonly personalRating?: number;
  readonly isFavorite?: boolean;
  readonly hasVisited?: boolean;
  readonly tags: readonly string[];
  readonly sources: readonly SourceLink[];
  readonly updatedAt?: string;
}

export interface AtlasItemEdit {
  readonly title: string;
  readonly description: string;
  readonly personalState: PersonalState;
}

export interface PlaceAssessment {
  readonly itemId: string;
  readonly overallRating?: number;
  readonly isFavorite: boolean;
  readonly hasVisited: boolean;
  readonly summary?: string;
  readonly updatedAt: string;
}

export interface PlaceAssessmentPatch {
  readonly overallRating?: number | null;
  readonly isFavorite?: boolean;
  readonly hasVisited?: boolean;
  readonly summary?: string | null;
}

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

export interface VisitRecord {
  readonly id: string;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly visitedAt: string;
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NewVisit {
  readonly itemId: string;
  readonly visitedAt: string;
  readonly rating?: number;
  readonly note?: string;
}

export interface VisitCreateResult {
  readonly visit: VisitRecord;
  readonly item: AtlasItem;
}

export interface AtlasSummary {
  readonly saved: number;
  readonly needsReview: number;
  readonly timeSensitive: number;
}
