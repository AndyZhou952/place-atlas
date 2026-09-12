export type AtlasItemKind = 'food' | 'event' | 'architecture';
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

export type CatalogProfile = 'verified_catalog' | 'full_merged_catalog';

export interface NearbyAtlasItem {
  readonly id: string;
  readonly title: string;
  readonly kind: AtlasItemKind;
  readonly area: string;
  readonly distanceKm: number;
  readonly tabelogScore?: number;
  readonly reservation: ReservationSnapshot;
}
