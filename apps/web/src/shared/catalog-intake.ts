// The Add (catalog intake) API contract shared by the server harness and the browser.
import type { ApplicationError, Result } from './result.ts';
import type { CatalogIntakeWarningCode } from './catalog-intake-warnings.ts';

export type AddErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'expired'
  | 'dependency_failure'
  | 'rate_limited'
  | 'unexpected_failure';

export interface AddError extends ApplicationError {
  readonly code: AddErrorCode;
  readonly retryable?: boolean;
}

export type AddResult<T> = Result<T, AddError>;

export interface CatalogIntakeAttribution {
  readonly label: string;
  readonly url: string;
}

export interface CatalogIntakeSourcedValue<T> {
  readonly value: T;
  readonly sourceUrl: string;
  readonly observedAt: string;
}

export interface CatalogIntakeEnrichedProfile {
  readonly name?: CatalogIntakeSourcedValue<string>;
  readonly area?: CatalogIntakeSourcedValue<string>;
  readonly address?: CatalogIntakeSourcedValue<string>;
  readonly coordinates?: CatalogIntakeSourcedValue<{
    readonly latitude: number;
    readonly longitude: number;
  }>;
  readonly categories?: CatalogIntakeSourcedValue<readonly string[]>;
  readonly signatureDishes?: CatalogIntakeSourcedValue<readonly string[]>;
  readonly summary?: CatalogIntakeSourcedValue<string>;
  readonly openingHours?: CatalogIntakeSourcedValue<string>;
  readonly regularClosingDays?: CatalogIntakeSourcedValue<string>;
  readonly closingNotes?: CatalogIntakeSourcedValue<string>;
  readonly officialWebsite?: CatalogIntakeSourcedValue<string>;
  readonly bookingLink?: CatalogIntakeSourcedValue<string>;
  readonly googleRating?: CatalogIntakeSourcedValue<{
    readonly score: number;
    readonly reviewCount?: number;
  }>;
}

export interface CatalogIntakeScope {
  readonly ownerId: string;
  readonly channel: string;
  readonly conversationId: string;
}

export interface CatalogIntakeDiscoverInput {
  readonly query: string;
  readonly requestToken: string;
}

export interface CatalogIntakeCandidateOutput {
  readonly ordinal: number;
  readonly transientName: string;
  readonly transientAddress: string;
  readonly attribution: CatalogIntakeAttribution;
}

export interface CatalogIntakeDiscoverOutput {
  readonly status: 'candidates_ready' | 'clarification_required';
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly candidates: readonly CatalogIntakeCandidateOutput[];
  readonly hasMore: boolean;
  readonly expiresAt: string;
}

export interface CatalogIntakeOwnerFields {
  readonly title?: string;
  readonly address?: string;
  readonly area?: string;
  readonly categories?: readonly string[];
  readonly signatureDishes?: readonly string[];
  readonly summary?: string;
  readonly openingHours?: {
    readonly value: string;
    readonly sourceUrl: string;
  };
  readonly regularClosingDays?: {
    readonly value: string;
    readonly sourceUrl: string;
  };
  readonly coordinates?: {
    readonly latitude: number;
    readonly longitude: number;
  };
}

export interface OwnerTabelogAssertion {
  readonly score: number;
  readonly reviewCount?: number;
  readonly url: string;
}

export interface OwnerReservationAssertion {
  readonly mode: 'reservable' | 'reservation_required' | 'not_reservable';
  readonly label: string;
  readonly advanceDays?: number;
  readonly bookingWindowLabel?: string;
  readonly releaseNote?: string;
  readonly channel?: string;
  readonly url: string;
}

export interface CatalogIntakeSelectInput {
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
  readonly ordinal: number;
  readonly ownerFields?: CatalogIntakeOwnerFields;
  readonly tabelog?: OwnerTabelogAssertion | 'unknown';
  readonly reservation?: OwnerReservationAssertion | 'unknown';
  /** Compatibility input; explicit server policy takes precedence. */
  readonly requestResearch?: boolean;
}

export interface CatalogIntakeClarification {
  readonly code: 'missing_area_or_address' | 'ambiguous_location' | 'duplicate_suspected';
  readonly prompt: string;
  readonly fields: readonly ('title' | 'area' | 'address' | 'coordinates')[];
}

export type CatalogIntakeTitleProposal =
  | { readonly provenance: 'owner_query'; readonly value: string }
  | {
      readonly provenance: 'agent_observed';
      readonly value: string;
      readonly sourceUrl: string;
      readonly observedAt: string;
    };

export type CatalogIntakeAddressProposal =
  | {
      readonly provenance: 'durable_geocoder_observed';
      readonly value: string;
      readonly sourceUrl: string;
      readonly license: string;
      readonly checkedAt: string;
    }
  | {
      readonly provenance: 'agent_observed';
      readonly value: string;
      readonly sourceUrl: string;
      readonly observedAt: string;
    };

export type CatalogIntakeLocationEvidence =
  | { readonly status: 'unknown' }
  | {
      readonly status: 'known';
      readonly provenance: 'agent_observed';
      readonly normalizedAddress: string;
      readonly latitude: number;
      readonly longitude: number;
      readonly sourceUrl: string;
      readonly observedAt: string;
    }
  | {
      readonly status: 'known';
      readonly provenance: 'durable_geocoder_observed';
      readonly normalizedAddress: string;
      readonly latitude: number;
      readonly longitude: number;
      readonly provider: string;
      readonly sourceUrl: string;
      readonly license: string;
      readonly checkedAt: string;
    }
  | {
      readonly status: 'known';
      readonly provenance: 'owner_asserted';
      readonly address: string;
      readonly latitude: number;
      readonly longitude: number;
      readonly assertedAt: string;
      readonly sourceUrl?: string;
    };

export type CatalogIntakeTabelogSnapshot =
  | { readonly status: 'unknown' }
  | {
      readonly status: 'known';
      readonly score: number;
      readonly reviewCount?: number;
      readonly url: string;
      readonly provenance: 'owner_asserted';
      readonly assertedAt: string;
      readonly freshness: 'fresh' | 'stale';
    }
  | {
      readonly status: 'known';
      readonly score: number;
      readonly reviewCount?: number;
      readonly url: string;
      readonly provenance: 'agent_observed';
      readonly observedAt: string;
      readonly freshness: 'fresh' | 'stale';
    };

export type CatalogIntakeReservationSnapshot =
  | { readonly status: 'unknown' }
  | ({
      readonly status: 'known';
      readonly provenance: 'owner_asserted';
      readonly assertedAt: string;
      readonly freshness: 'fresh' | 'stale';
    } & OwnerReservationAssertion)
  | ({
      readonly status: 'known';
      readonly provenance: 'agent_observed';
      readonly observedAt: string;
      readonly freshness: 'fresh' | 'stale';
    } & OwnerReservationAssertion);

export interface CatalogIntakeSuspectedDuplicate {
  readonly itemId: string;
  readonly title: string;
  readonly address?: string;
  readonly match: 'strong' | 'weak';
}

export interface CatalogIntakeWarning {
  readonly code: CatalogIntakeWarningCode;
  readonly message: string;
}

export interface CatalogIntakePreview {
  readonly profile?: CatalogIntakeEnrichedProfile;
  readonly sessionId: string;
  readonly previewVersion: number;
  readonly state: 'preview_ready';
  readonly candidateIdentity: {
    readonly providerNamespace: string;
    readonly placeId: string;
  };
  readonly ownerFields: CatalogIntakeOwnerFields;
  readonly titleProposal?: CatalogIntakeTitleProposal;
  readonly addressProposal?: CatalogIntakeAddressProposal;
  readonly clarification?: CatalogIntakeClarification;
  readonly locationEvidence: CatalogIntakeLocationEvidence;
  readonly tabelog: CatalogIntakeTabelogSnapshot;
  readonly reservation: CatalogIntakeReservationSnapshot;
  readonly suspectedDuplicates: readonly CatalogIntakeSuspectedDuplicate[];
  readonly unknownFields: readonly ('address' | 'coordinates' | 'tabelog' | 'reservation')[];
  readonly warnings: readonly CatalogIntakeWarning[];
  readonly evidenceDigest: string;
  readonly catalogRevision: string;
  readonly expiresAt: string;
}

export type CatalogIntakeSelectOutput =
  | {
      readonly status: 'preview_ready';
      readonly sessionId: string;
      readonly sessionVersion: number;
      readonly preview: CatalogIntakePreview;
      readonly expiresAt: string;
    }
  | {
      readonly status: 'clarification_required';
      readonly sessionId: string;
      readonly sessionVersion: number;
      readonly clarification: CatalogIntakeClarification;
      readonly expiresAt: string;
    };

export interface CatalogIntakeConfirmInput {
  readonly sessionId: string;
  readonly expectedPreviewVersion: number;
}

export type CatalogIntakeConfirmOutput =
  | {
      readonly status: 'committed_verified' | 'committed_needs_review' | 'reused_existing';
      readonly itemId: string;
      readonly receiptRef: string;
      readonly replayed: boolean;
    }
  | { readonly status: 'conflict'; readonly newPreview: CatalogIntakePreview }
  | { readonly status: 'already_saved'; readonly itemId: string }
  | {
      readonly status: 'failed_no_write';
      readonly reason: 'validation' | 'dependency' | 'transaction';
    };

export interface CatalogIntakeCancelInput {
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
}

export interface CatalogIntakeCancelOutput {
  readonly status: 'cancelled';
  readonly sessionId: string;
  readonly replayed: boolean;
}
