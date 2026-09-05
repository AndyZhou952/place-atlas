export type AtlasItemKind = 'food' | 'event' | 'architecture';

export type ReservationMode =
  | 'walk-in'
  | 'same-day'
  | 'advance'
  | 'ticketed'
  | 'unknown';

export interface AtlasItem {
  readonly id: string;
  readonly kind: AtlasItemKind;
  readonly name: string;
  readonly localName: string;
  readonly area: string;
  readonly summary: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly sourceCount: number;
  readonly sourceLabel: string;
  readonly reservationMode: ReservationMode;
  readonly reservationLabel: string;
  readonly freshnessLabel: string;
  readonly personalState: 'saved' | 'planned' | 'visited';
  readonly personalRating?: number;
  readonly tags: readonly string[];
}

export type AtlasKindFilter = 'all' | AtlasItemKind;

export interface AtlasSummary {
  readonly saved: number;
  readonly needsReview: number;
  readonly openingSoon: number;
}
