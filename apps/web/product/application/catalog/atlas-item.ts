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
  readonly checkedAt?: string;
}

export interface EventSchedule {
  readonly startDate: string;
  readonly endDate: string;
  readonly displayDate: string;
}

export interface AtlasIntakeEvidence {
  readonly profile?: CatalogIntakeEnrichedProfile;
  readonly candidateIdentity: {
    readonly providerNamespace: string;
    readonly placeId: string;
  };
  readonly ownerFields: CatalogIntakeOwnerFields;
  readonly titleProposal?: CatalogIntakeTitleProposal;
  readonly addressProposal?: CatalogIntakeAddressProposal;
  readonly locationEvidence: CatalogIntakeLocationEvidence;
  readonly tabelog: CatalogIntakeTabelogSnapshot;
  readonly reservation: CatalogIntakeReservationSnapshot;
  readonly unknownFields: readonly (
    | 'address'
    | 'coordinates'
    | 'tabelog'
    | 'reservation'
  )[];
  readonly warnings: readonly CatalogIntakeWarning[];
}

export interface AtlasItem {
  readonly id: string;
  readonly kind: AtlasItemKind;
  readonly title: string;
  readonly alternateTitle?: string;
  readonly area: string;
  readonly address: string;
  readonly description: string;
  readonly openingHours?: CatalogIntakeSourcedValue<string>;
  readonly regularClosingDays?: CatalogIntakeSourcedValue<string>;
  readonly closingNotes?: CatalogIntakeSourcedValue<string>;
  readonly scheduleCheck?: {
    readonly openingHours: 'known' | 'unavailable';
    readonly regularClosingDays: 'known' | 'unavailable';
    readonly checkedAt: string;
  };
  readonly latitude: number;
  readonly longitude: number;
  readonly verificationStatus: VerificationStatus;
  readonly verifiedAt: string;
  readonly officialUrl?: string;
  readonly tabelog?: TabelogSnapshot;
  readonly googleRating?: TabelogSnapshot;
  readonly googlePlaceId?: string;
  readonly reservation: ReservationSnapshot;
  readonly event?: EventSchedule;
  readonly personalState: PersonalState;
  readonly personalRating?: number;
  readonly isFavorite?: boolean;
  readonly hasVisited?: boolean;
  readonly tags: readonly string[];
  readonly classification?: RestaurantClassification;
  readonly sources: readonly SourceLink[];
  readonly intakeEvidence?: AtlasIntakeEvidence;
  readonly updatedAt?: string;
}

export interface AtlasReviewCandidate {
  readonly recordType: 'review_candidate';
  readonly id: string;
  readonly kind: 'food';
  readonly title: string;
  readonly area?: string;
  readonly description: string;
  readonly verificationStatus: 'needs_review';
  readonly personalState: PersonalState;
  readonly personalRating?: number;
  readonly isFavorite?: boolean;
  readonly hasVisited?: boolean;
  readonly tags: readonly string[];
  readonly classification?: RestaurantClassification;
  readonly reviewEvidence: AtlasIntakeEvidence;
  readonly updatedAt: string;
}

export type AtlasCatalogEntry = AtlasItem | AtlasReviewCandidate;

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
import type {
  CatalogIntakeSourcedValue,
  CatalogIntakeEnrichedProfile,
  CatalogIntakeAddressProposal,
  CatalogIntakeLocationEvidence,
  CatalogIntakeOwnerFields,
  CatalogIntakeReservationSnapshot,
  CatalogIntakeTabelogSnapshot,
  CatalogIntakeTitleProposal,
  CatalogIntakeWarning,
} from '../catalog-intake/catalog-intake-coordinator.ts';
import type { RestaurantClassification } from './restaurant-classification-types.ts';
