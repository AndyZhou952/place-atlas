import type { AtlasReviewCandidate } from '../../../../../product/application/catalog/atlas-item.ts';

export interface OwnerReviewCandidateV1 {
  readonly recordType: 'review_candidate';
  readonly id: string;
  readonly kind: 'food';
  readonly title: string;
  readonly description: string;
  readonly verificationStatus: 'needs_review';
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
        readonly provenance: 'owner_asserted' | 'durable_geocoder_observed';
        readonly sourceUrl?: string;
        readonly assertedAt?: string;
        readonly checkedAt?: string;
        readonly provider?: string;
        readonly license?: string;
      }
    | { readonly status: 'unknown' };
  readonly tabelog: AtlasReviewCandidate['reviewEvidence']['tabelog'];
  readonly reservation: AtlasReviewCandidate['reviewEvidence']['reservation'];
  readonly unknownFields: AtlasReviewCandidate['reviewEvidence']['unknownFields'];
  readonly warnings: AtlasReviewCandidate['reviewEvidence']['warnings'];
  readonly personalState: AtlasReviewCandidate['personalState'];
  readonly personalRating?: number;
  readonly isFavorite?: boolean;
  readonly hasVisited?: boolean;
  readonly tags: readonly string[];
  readonly updatedAt: string;
}

export function projectOwnerReviewCandidate(
  candidate: AtlasReviewCandidate,
): OwnerReviewCandidateV1 {
  return {
    recordType: 'review_candidate',
    id: candidate.id,
    kind: 'food',
    title: candidate.title,
    description: candidate.description,
    verificationStatus: 'needs_review',
    area: candidate.area
      ? { status: 'known', value: candidate.area }
      : { status: 'unknown' },
    location: projectLocation(candidate.reviewEvidence.locationEvidence),
    tabelog: projectTabelog(candidate.reviewEvidence.tabelog),
    reservation: projectReservation(candidate.reviewEvidence.reservation),
    unknownFields: [...candidate.reviewEvidence.unknownFields],
    warnings: candidate.reviewEvidence.warnings.map(({ code, message }) => ({
      code,
      message,
    })),
    personalState: candidate.personalState,
    ...(candidate.personalRating === undefined
      ? {}
      : { personalRating: candidate.personalRating }),
    ...(candidate.isFavorite === undefined
      ? {}
      : { isFavorite: candidate.isFavorite }),
    ...(candidate.hasVisited === undefined
      ? {}
      : { hasVisited: candidate.hasVisited }),
    tags: [...candidate.tags],
    updatedAt: candidate.updatedAt,
  };
}

function projectLocation(
  location: AtlasReviewCandidate['reviewEvidence']['locationEvidence'],
): OwnerReviewCandidateV1['location'] {
  if (location.status === 'unknown') return { status: 'unknown' };
  if (location.provenance === 'owner_asserted') {
    return {
      status: 'known',
      address: location.address,
      coordinates: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
      provenance: 'owner_asserted',
      ...(location.sourceUrl ? { sourceUrl: location.sourceUrl } : {}),
      assertedAt: location.assertedAt,
    };
  }
  return {
    status: 'known',
    address: location.normalizedAddress,
    coordinates: {
      latitude: location.latitude,
      longitude: location.longitude,
    },
    provenance: 'durable_geocoder_observed',
    sourceUrl: location.sourceUrl,
    checkedAt: location.checkedAt,
    provider: location.provider,
    license: location.license,
  };
}

function projectTabelog(
  tabelog: AtlasReviewCandidate['reviewEvidence']['tabelog'],
): AtlasReviewCandidate['reviewEvidence']['tabelog'] {
  if (tabelog.status === 'unknown') return { status: 'unknown' };
  const shared = {
    status: 'known' as const,
    score: tabelog.score,
    ...(tabelog.reviewCount === undefined
      ? {}
      : { reviewCount: tabelog.reviewCount }),
    url: tabelog.url,
    freshness: tabelog.freshness,
  };
  return tabelog.provenance === 'owner_asserted'
    ? {
        ...shared,
        provenance: 'owner_asserted',
        assertedAt: tabelog.assertedAt,
      }
    : {
        ...shared,
        provenance: 'agent_observed',
        observedAt: tabelog.observedAt,
      };
}

function projectReservation(
  reservation: AtlasReviewCandidate['reviewEvidence']['reservation'],
): AtlasReviewCandidate['reviewEvidence']['reservation'] {
  if (reservation.status === 'unknown') return { status: 'unknown' };
  const shared = {
    status: 'known' as const,
    mode: reservation.mode,
    label: reservation.label,
    ...(reservation.advanceDays === undefined
      ? {}
      : { advanceDays: reservation.advanceDays }),
    ...(reservation.bookingWindowLabel === undefined
      ? {}
      : { bookingWindowLabel: reservation.bookingWindowLabel }),
    ...(reservation.releaseNote === undefined
      ? {}
      : { releaseNote: reservation.releaseNote }),
    ...(reservation.channel === undefined
      ? {}
      : { channel: reservation.channel }),
    url: reservation.url,
    freshness: reservation.freshness,
  };
  return reservation.provenance === 'owner_asserted'
    ? {
        ...shared,
        provenance: 'owner_asserted',
        assertedAt: reservation.assertedAt,
      }
    : {
        ...shared,
        provenance: 'agent_observed',
        observedAt: reservation.observedAt,
      };
}
