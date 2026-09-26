import type { PersonalState } from './model';

/** Closed browser view for an Owner-only catalog review candidate. */
export interface OwnerReviewCandidateView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly area:
    | { readonly status: 'known'; readonly value: string }
    | { readonly status: 'unknown' };
  readonly location:
    | {
        readonly status: 'known';
        readonly address: string;
        readonly coordinates: {
          readonly latitude: number;
          readonly longitude: number;
        };
        readonly provenance: 'agent_observed';
        readonly sourceUrl: string;
        readonly observedAt: string;
      }
    | {
        readonly status: 'known';
        readonly address: string;
        readonly coordinates: {
          readonly latitude: number;
          readonly longitude: number;
        };
        readonly provenance: 'owner_asserted';
        readonly sourceUrl?: string;
        readonly assertedAt: string;
      }
    | {
        readonly status: 'known';
        readonly address: string;
        readonly coordinates: {
          readonly latitude: number;
          readonly longitude: number;
        };
        readonly provenance: 'durable_geocoder_observed';
        readonly sourceUrl: string;
        readonly checkedAt: string;
        readonly provider: string;
        readonly license: string;
      }
    | { readonly status: 'unknown' };
  readonly tabelog:
    | { readonly status: 'unknown' }
    | {
        readonly status: 'known';
        readonly score: number;
        readonly reviewCount?: number;
        readonly url: string;
        readonly freshness: 'fresh' | 'stale';
        readonly provenance: 'owner_asserted';
        readonly assertedAt: string;
      }
    | {
        readonly status: 'known';
        readonly score: number;
        readonly reviewCount?: number;
        readonly url: string;
        readonly freshness: 'fresh' | 'stale';
        readonly provenance: 'agent_observed';
        readonly observedAt: string;
      };
  readonly reservation:
    | { readonly status: 'unknown' }
    | {
        readonly status: 'known';
        readonly mode: 'reservable' | 'reservation_required' | 'not_reservable';
        readonly label: string;
        readonly advanceDays?: number;
        readonly bookingWindowLabel?: string;
        readonly releaseNote?: string;
        readonly channel?: string;
        readonly url: string;
        readonly freshness: 'fresh' | 'stale';
        readonly provenance: 'owner_asserted';
        readonly assertedAt: string;
      }
    | {
        readonly status: 'known';
        readonly mode: 'reservable' | 'reservation_required' | 'not_reservable';
        readonly label: string;
        readonly advanceDays?: number;
        readonly bookingWindowLabel?: string;
        readonly releaseNote?: string;
        readonly channel?: string;
        readonly url: string;
        readonly freshness: 'fresh' | 'stale';
        readonly provenance: 'agent_observed';
        readonly observedAt: string;
      };
  readonly unknownFields: readonly string[];
  readonly warnings: readonly {
    readonly code: string;
    readonly message: string;
  }[];
  readonly personalState: PersonalState;
  readonly personalRating?: number;
  readonly isFavorite?: boolean;
  readonly hasVisited?: boolean;
  readonly tags: readonly string[];
  readonly updatedAt: string;
}
