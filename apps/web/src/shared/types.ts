// Data transfer objects shared by the Worker API and the browser.

export interface SourcedText {
  readonly value: string;
  readonly sourceUrl: string;
  readonly observedAt: string;
}

export type ReservationPolicy = 'reservable' | 'required' | 'not_reservable' | 'unknown';

export interface Reservation {
  readonly policy: ReservationPolicy;
  readonly label: string;
  /** A booking destination other than the Tabelog listing. */
  readonly bookingUrl?: string;
  readonly note?: string;
}

export interface Restaurant {
  readonly id: string;
  readonly title: string;
  readonly alternateTitle?: string;
  readonly area: string;
  readonly address: string;
  readonly description: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly tags: readonly string[];
  /** Cuisine category ids from `cuisine.ts`, e.g. `japanese.ramen`. */
  readonly cuisines: readonly string[];
  /** ISO 3166-2 prefecture code, e.g. `JP-13`. */
  readonly prefecture?: string;
  readonly tabelog?: { readonly score?: number; readonly url: string };
  readonly googlePlaceId?: string;
  readonly officialUrl?: string;
  readonly reservation: Reservation;
  readonly openingHours?: SourcedText;
  readonly regularClosingDays?: SourcedText;
  readonly closingNotes?: SourcedText;
  readonly addedAt: string;
  readonly updatedAt: string;
  // Personal assessment, public by design.
  readonly rating?: number;
  readonly favorite: boolean;
  readonly visited: boolean;
  readonly comment?: string;
}

export interface Media {
  /** Opaque public display id (`pm_…`). */
  readonly id: string;
  readonly visitId: string;
  readonly contentType: string;
  readonly caption?: string;
  readonly url: string;
}

export interface Visit {
  readonly id: string;
  readonly restaurantId: string;
  readonly visitedOn: string;
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly media: readonly Media[];
}

export interface RestaurantPatch {
  readonly title?: string;
  readonly description?: string;
  readonly rating?: number | null;
  readonly favorite?: boolean;
  readonly visited?: boolean;
  readonly comment?: string | null;
}

export interface VisitInput {
  readonly restaurantId: string;
  readonly visitedOn: string;
  readonly note?: string;
  /** Updates the restaurant's overall rating; null clears it. */
  readonly rating?: number | null;
}

export interface GoogleRating {
  readonly score: number;
  readonly reviewCount?: number;
  readonly url: string;
  readonly observedAt: string;
}

export interface ModelSettingsStatus {
  readonly configured: boolean;
  readonly source: 'owner' | 'deployment' | 'none';
  readonly baseUrl: string;
  readonly model: string;
  readonly canSave: boolean;
}
