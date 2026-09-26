export type PublicReadPrincipal =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'owner'; readonly subject?: string };

export type PublicJsonReadOperation =
  | 'catalog.list'
  | 'catalog.get'
  | 'assessment.display'
  | 'visit.listDisplay'
  | 'visit.getDisplay';

export type PublicMediaReadOperation = 'media.openDisplay';
export type PublicReadOperation =
  | PublicJsonReadOperation
  | PublicMediaReadOperation;

export interface PublicCatalogItemV1 {
  readonly id: string;
  readonly kind: 'food' | 'event' | 'architecture';
  readonly title: string;
  readonly alternateTitle?: string;
  readonly area: string;
  readonly address: string;
  readonly description: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly verificationStatus: 'verified' | 'needs_review';
  readonly verifiedAt?: string;
  readonly officialUrl?: string;
  readonly tabelog?: PublicTabelogEvidenceV1;
  readonly googleRating?: PublicTabelogEvidenceV1;
  readonly reservation: PublicReservationEvidenceV1;
  readonly event?: {
    readonly startDate: string;
    readonly endDate: string;
    readonly displayDate: string;
  };
  readonly tags: readonly string[];
  readonly sources: readonly PublicSourceEvidenceV1[];
}

type PublicTabelogEvidenceV1 =
  | {
      readonly score: number;
      readonly reviewCount?: number;
      readonly url: string;
      readonly checkedAt: string;
    }
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

type PublicReservationEvidenceV1 =
  | { readonly status: 'unknown' }
  | {
      readonly mode:
        | 'walk-in'
        | 'same-day'
        | 'advance'
        | 'ticketed'
        | 'unavailable'
        | 'unknown';
      readonly label: string;
      readonly checkedAt: string;
      readonly channel?: string;
      readonly url?: string;
      readonly advanceDays?: number;
      readonly bookingWindowLabel?: string;
      readonly releaseNote?: string;
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
      readonly provenance: 'owner_asserted';
      readonly assertedAt: string;
      readonly freshness: 'fresh' | 'stale';
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
      readonly provenance: 'agent_observed';
      readonly observedAt: string;
      readonly freshness: 'fresh' | 'stale';
    };

type PublicSourceEvidenceV1 =
  | {
      readonly label: string;
      readonly url: string;
      readonly role:
        | 'identity'
        | 'location'
        | 'official'
        | 'tabelog'
        | 'reservation'
        | 'discovery';
    }
  | {
      readonly role: 'identity' | 'location' | 'tabelog' | 'reservation';
      readonly label: string;
      readonly url?: string;
      readonly provenance: 'owner_asserted';
      readonly assertedAt: string;
    }
  | {
      readonly role: 'identity' | 'location' | 'tabelog' | 'reservation';
      readonly label: string;
      readonly url: string;
      readonly provenance: 'agent_observed';
      readonly observedAt: string;
    }
  | {
      readonly role: 'location';
      readonly label: string;
      readonly url: string;
      readonly provenance: 'durable_geocoder_observed';
      readonly checkedAt: string;
      readonly license: string;
    };

export interface PublicAssessmentV1 {
  readonly itemId: string;
  readonly favorite: boolean;
  readonly manualVisited: boolean;
  readonly effectiveVisited: boolean;
  readonly personalRating?: number;
  readonly overallComment?: string;
}

export interface PublicVisitMediaV1 {
  readonly id: string;
  readonly visitId: string;
  readonly displayOrder: number;
  readonly caption?: string;
  readonly displayUrl: string;
}

export interface PublicVisitV1 {
  readonly id: string;
  readonly itemId: string;
  readonly visitedOn: string;
  readonly displayNote?: string;
  readonly media: readonly PublicVisitMediaV1[];
}

export interface PublicReadAuthorization {
  readonly allowed: boolean;
}

export interface PublicReadManifest {
  authorize(
    operation: string,
    principal: PublicReadPrincipal,
  ): PublicReadAuthorization;
  project(operation: PublicJsonReadOperation, result: unknown): unknown;
}

export function createPublicReadManifest(): PublicReadManifest {
  return {
    authorize(operation, principal) {
      return {
        allowed:
          isKnownPrincipal(principal) && isPublicReadOperation(operation),
      };
    },
    project(operation, result) {
      switch (operation) {
        case 'catalog.list':
          return asArray(result).map((entry) =>
            projectCatalogItem(asRecord(entry)),
          );
        case 'catalog.get':
          return projectCatalogItem(asRecord(result));
        case 'assessment.display':
          return projectAssessment(asRecord(result));
        case 'visit.listDisplay':
          return asArray(result).map((entry) => projectVisit(asRecord(entry)));
        case 'visit.getDisplay':
          return projectVisit(asRecord(result));
      }
    },
  };
}

interface ExecutePublicJsonReadInput {
  readonly manifest: PublicReadManifest;
  readonly operation: string;
  readonly principal: PublicReadPrincipal;
  readonly load: () => Promise<unknown>;
}

export async function executePublicJsonRead({
  manifest,
  operation,
  principal,
  load,
}: ExecutePublicJsonReadInput): Promise<Response> {
  const authorization = manifest.authorize(operation, principal);
  if (!authorization.allowed || !isPublicJsonReadOperation(operation)) {
    return publicReadNotFound();
  }

  try {
    return Response.json(manifest.project(operation, await load()), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return new Response('Public data is temporarily unavailable.', {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    });
  }
}

interface PublicMediaContent {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
}

interface ExecutePublicMediaReadInput {
  readonly manifest: PublicReadManifest;
  readonly operation: string;
  readonly principal: PublicReadPrincipal;
  readonly load: () => Promise<PublicMediaContent>;
}

export async function executePublicMediaRead({
  manifest,
  operation,
  principal,
  load,
}: ExecutePublicMediaReadInput): Promise<Response> {
  const authorization = manifest.authorize(operation, principal);
  if (!authorization.allowed || operation !== 'media.openDisplay') {
    return publicReadNotFound();
  }

  try {
    const content = await load();
    if (!isAllowedImageContentType(content.contentType)) {
      await content.body.cancel('unsupported public media type');
      return new Response('Photo content type is unavailable.', {
        status: 415,
      });
    }
    return new Response(content.body, {
      headers: {
        'cache-control': 'public, max-age=3600',
        'content-disposition': 'inline',
        'content-type': content.contentType,
      },
    });
  } catch {
    return new Response('Photo content is temporarily unavailable.', {
      status: 500,
    });
  }
}

function projectCatalogItem(source: Readonly<Record<string, unknown>>) {
  const intakeEvidence =
    source.intakeEvidence === undefined
      ? undefined
      : asRecord(source.intakeEvidence);
  const intakeTabelog = intakeEvidence
    ? asRecord(intakeEvidence.tabelog)
    : undefined;
  const reservation = asRecord(source.reservation);
  const projected: PublicCatalogItemV1 = {
    id: asString(source.id),
    kind: asCatalogKind(source.kind),
    title: asString(source.title),
    ...(optionalString(source.alternateTitle) === undefined
      ? {}
      : { alternateTitle: optionalString(source.alternateTitle) }),
    area: asString(source.area),
    address: asString(source.address),
    description: asString(source.description),
    latitude: asNumber(source.latitude),
    longitude: asNumber(source.longitude),
    verificationStatus: asVerificationStatus(source.verificationStatus),
    ...(optionalString(source.verifiedAt) === undefined
      ? {}
      : { verifiedAt: optionalString(source.verifiedAt) }),
    ...(optionalString(source.officialUrl) === undefined
      ? {}
      : { officialUrl: optionalString(source.officialUrl) }),
    ...(intakeEvidence
      ? intakeTabelog?.status === 'known'
        ? { tabelog: projectTabelog(intakeTabelog) }
        : {}
      : source.tabelog === undefined
        ? {}
        : { tabelog: projectTabelog(asRecord(source.tabelog)) }),
    reservation: projectReservation(
      intakeEvidence ? asRecord(intakeEvidence.reservation) : reservation,
    ),
    ...(source.googleRating === undefined
      ? {}
      : { googleRating: projectTabelog(asRecord(source.googleRating)) }),
    ...(source.event === undefined
      ? {}
      : { event: projectEvent(asRecord(source.event)) }),
    tags: asArray(source.tags).map(asString),
    sources: intakeEvidence
      ? projectIntakeSources(intakeEvidence)
      : asArray(source.sources).map((entry) => projectSource(asRecord(entry))),
  };
  return projected;
}

function projectIntakeSources(
  evidence: Readonly<Record<string, unknown>>,
): readonly PublicSourceEvidenceV1[] {
  const candidates: Record<string, unknown>[] = [];
  if (evidence.profile !== undefined) {
    const profile = asRecord(evidence.profile);
    for (const [key, role, label] of [
      ['officialWebsite', 'official', 'Official website'],
      ['bookingLink', 'reservation', 'Booking'],
    ]) {
      if (profile[key] !== undefined)
        candidates.push({
          role,
          label,
          url: asString(asRecord(profile[key]).value),
        });
    }
  }
  const location = asRecord(evidence.locationEvidence);
  if (location.status === 'known' && location.provenance === 'agent_observed') {
    candidates.push({
      role: 'location',
      label: 'Location source',
      url: asString(location.sourceUrl),
      provenance: 'agent_observed',
      observedAt: asString(location.observedAt),
    });
  }
  if (
    location.status === 'known' &&
    location.provenance === 'durable_geocoder_observed'
  ) {
    candidates.push({
      role: 'location',
      label: asString(location.provider),
      url: asString(location.sourceUrl),
      provenance: 'durable_geocoder_observed',
      checkedAt: asString(location.checkedAt),
      license: asString(location.license),
    });
  } else if (
    location.status === 'known' &&
    location.provenance === 'owner_asserted'
  ) {
    candidates.push({
      role: 'location',
      label: 'Owner provided location',
      ...(location.sourceUrl === undefined
        ? {}
        : { url: asString(location.sourceUrl) }),
      provenance: 'owner_asserted',
      assertedAt: asString(location.assertedAt),
    });
  }

  const tabelog = asRecord(evidence.tabelog);
  if (tabelog.status === 'known') {
    candidates.push({
      role: 'tabelog',
      label: 'Tabelog',
      url: asString(tabelog.url),
      provenance: tabelog.provenance,
      ...(tabelog.provenance === 'owner_asserted'
        ? { assertedAt: asString(tabelog.assertedAt) }
        : { observedAt: asString(tabelog.observedAt) }),
    });
  }

  const reservation = asRecord(evidence.reservation);
  if (reservation.status === 'known') {
    candidates.push({
      role: 'reservation',
      label: asString(reservation.label),
      url: asString(reservation.url),
      provenance: reservation.provenance,
      ...(reservation.provenance === 'owner_asserted'
        ? { assertedAt: asString(reservation.assertedAt) }
        : { observedAt: asString(reservation.observedAt) }),
    });
  }
  return candidates.map((candidate) => projectSource(candidate));
}

function projectAssessment(
  source: Readonly<Record<string, unknown>>,
): PublicAssessmentV1 {
  return {
    itemId: asString(source.itemId),
    favorite: asBoolean(source.isFavorite),
    manualVisited: asBoolean(source.manualVisited),
    effectiveVisited: asBoolean(source.effectiveVisited),
    ...(source.overallRating === undefined
      ? {}
      : { personalRating: asNumber(source.overallRating) }),
    ...(optionalString(source.summary) === undefined
      ? {}
      : { overallComment: optionalString(source.summary) }),
  };
}

function projectVisit(
  source: Readonly<Record<string, unknown>>,
): PublicVisitV1 {
  return {
    id: asString(source.id),
    itemId: asString(source.itemId),
    visitedOn: asString(source.visitedAt),
    ...(optionalString(source.note) === undefined
      ? {}
      : { displayNote: optionalString(source.note) }),
    media: asArray(source.media).map((entry) =>
      projectVisitMedia(asRecord(entry)),
    ),
  };
}

function projectVisitMedia(
  source: Readonly<Record<string, unknown>>,
): PublicVisitMediaV1 {
  const displayId = asString(source.displayId);
  return {
    id: displayId,
    visitId: asString(source.visitId),
    displayOrder: asNumber(source.displayOrder),
    ...(optionalString(source.caption) === undefined
      ? {}
      : { caption: optionalString(source.caption) }),
    displayUrl: `/api/media/${encodeURIComponent(displayId)}/content`,
  };
}

function projectTabelog(source: Readonly<Record<string, unknown>>) {
  if (source.status === 'known') {
    const shared = {
      status: 'known' as const,
      score: asNumber(source.score),
      ...(source.reviewCount === undefined
        ? {}
        : { reviewCount: asNumber(source.reviewCount) }),
      url: asString(source.url),
      freshness: asFreshness(source.freshness),
    };
    if (source.provenance === 'owner_asserted') {
      return {
        ...shared,
        provenance: 'owner_asserted' as const,
        assertedAt: asString(source.assertedAt),
      };
    }
    if (source.provenance === 'agent_observed') {
      return {
        ...shared,
        provenance: 'agent_observed' as const,
        observedAt: asString(source.observedAt),
      };
    }
    throw new TypeError('Expected Tabelog provenance');
  }
  return {
    score: asNumber(source.score),
    ...(source.reviewCount === undefined
      ? {}
      : { reviewCount: asNumber(source.reviewCount) }),
    url: asString(source.url),
    checkedAt: asString(source.checkedAt),
  };
}

function projectReservation(
  source: Readonly<Record<string, unknown>>,
): PublicReservationEvidenceV1 {
  if (source.status === 'unknown') return { status: 'unknown' as const };
  if (source.status === 'known') {
    const shared = {
      status: 'known' as const,
      mode: asIntakeReservationMode(source.mode),
      label: asString(source.label),
      ...(source.advanceDays === undefined
        ? {}
        : { advanceDays: asNumber(source.advanceDays) }),
      ...(optionalString(source.bookingWindowLabel) === undefined
        ? {}
        : { bookingWindowLabel: optionalString(source.bookingWindowLabel) }),
      ...(optionalString(source.releaseNote) === undefined
        ? {}
        : { releaseNote: optionalString(source.releaseNote) }),
      ...(optionalString(source.channel) === undefined
        ? {}
        : { channel: optionalString(source.channel) }),
      url: asString(source.url),
      freshness: asFreshness(source.freshness),
    };
    if (source.provenance === 'owner_asserted') {
      return {
        ...shared,
        provenance: 'owner_asserted' as const,
        assertedAt: asString(source.assertedAt),
      };
    }
    if (source.provenance === 'agent_observed') {
      return {
        ...shared,
        provenance: 'agent_observed' as const,
        observedAt: asString(source.observedAt),
      };
    }
    throw new TypeError('Expected reservation provenance');
  }
  return {
    mode: asReservationMode(source.mode),
    label: asString(source.label),
    checkedAt: asString(source.checkedAt),
    ...(optionalString(source.channel) === undefined
      ? {}
      : { channel: optionalString(source.channel) }),
    ...(optionalString(source.url) === undefined
      ? {}
      : { url: optionalString(source.url) }),
    ...(source.advanceDays === undefined
      ? {}
      : { advanceDays: asNumber(source.advanceDays) }),
    ...(optionalString(source.bookingWindowLabel) === undefined
      ? {}
      : { bookingWindowLabel: optionalString(source.bookingWindowLabel) }),
    ...(optionalString(source.releaseNote) === undefined
      ? {}
      : { releaseNote: optionalString(source.releaseNote) }),
  };
}

function projectEvent(source: Readonly<Record<string, unknown>>) {
  return {
    startDate: asString(source.startDate),
    endDate: asString(source.endDate),
    displayDate: asString(source.displayDate),
  };
}

function projectSource(
  source: Readonly<Record<string, unknown>>,
): PublicSourceEvidenceV1 {
  if (source.provenance === 'owner_asserted') {
    return {
      role: asIntakeSourceRole(source.role),
      label: asString(source.label),
      ...(source.url === undefined ? {} : { url: asString(source.url) }),
      provenance: 'owner_asserted' as const,
      assertedAt: asString(source.assertedAt),
    };
  }
  if (source.provenance === 'agent_observed') {
    return {
      role: asIntakeSourceRole(source.role),
      label: asString(source.label),
      url: asString(source.url),
      provenance: 'agent_observed' as const,
      observedAt: asString(source.observedAt),
    };
  }
  if (source.provenance === 'durable_geocoder_observed') {
    if (source.role !== 'location') {
      throw new TypeError('Durable geocoder source must be location');
    }
    return {
      role: 'location' as const,
      label: asString(source.label),
      url: asString(source.url),
      provenance: 'durable_geocoder_observed' as const,
      checkedAt: asString(source.checkedAt),
      license: asString(source.license),
    };
  }
  return {
    label: asString(source.label),
    url: asString(source.url),
    role: asSourceRole(source.role),
  };
}

function isPublicReadOperation(value: string): value is PublicReadOperation {
  return isPublicJsonReadOperation(value) || value === 'media.openDisplay';
}

function isPublicJsonReadOperation(
  value: string,
): value is PublicJsonReadOperation {
  return (
    value === 'catalog.list' ||
    value === 'catalog.get' ||
    value === 'assessment.display' ||
    value === 'visit.listDisplay' ||
    value === 'visit.getDisplay'
  );
}

function isKnownPrincipal(value: PublicReadPrincipal): boolean {
  return value.kind === 'anonymous' || value.kind === 'owner';
}

function publicReadNotFound(): Response {
  return new Response('Public resource not found.', {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });
}

function isAllowedImageContentType(value: string): boolean {
  return (
    value === 'image/jpeg' ||
    value === 'image/png' ||
    value === 'image/webp' ||
    value === 'image/gif'
  );
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected record');
  }
  return value as Readonly<Record<string, unknown>>;
}

function asArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Expected array');
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected string');
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return asString(value);
}

function asNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Expected finite number');
  }
  return value;
}

function asBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Expected boolean');
  return value;
}

function asCatalogKind(value: unknown): PublicCatalogItemV1['kind'] {
  if (value === 'food' || value === 'event' || value === 'architecture') {
    return value;
  }
  throw new TypeError('Expected catalog kind');
}

function asVerificationStatus(
  value: unknown,
): PublicCatalogItemV1['verificationStatus'] {
  if (value === 'verified' || value === 'needs_review') return value;
  throw new TypeError('Expected verification status');
}

function asReservationMode(
  value: unknown,
): 'walk-in' | 'same-day' | 'advance' | 'ticketed' | 'unavailable' | 'unknown' {
  if (
    value === 'walk-in' ||
    value === 'same-day' ||
    value === 'advance' ||
    value === 'ticketed' ||
    value === 'unavailable' ||
    value === 'unknown'
  ) {
    return value;
  }
  throw new TypeError('Expected reservation mode');
}

function asIntakeReservationMode(
  value: unknown,
): 'reservable' | 'reservation_required' | 'not_reservable' {
  if (
    value === 'reservable' ||
    value === 'reservation_required' ||
    value === 'not_reservable'
  )
    return value;
  throw new TypeError('Expected intake reservation mode');
}

function asFreshness(value: unknown): 'fresh' | 'stale' {
  if (value === 'fresh' || value === 'stale') return value;
  throw new TypeError('Expected evidence freshness');
}

function asIntakeSourceRole(
  value: unknown,
): 'identity' | 'location' | 'tabelog' | 'reservation' {
  if (
    value === 'identity' ||
    value === 'location' ||
    value === 'tabelog' ||
    value === 'reservation'
  ) {
    return value;
  }
  throw new TypeError('Expected intake source role');
}

function asSourceRole(
  value: unknown,
): PublicCatalogItemV1['sources'][number]['role'] {
  if (
    value === 'official' ||
    value === 'tabelog' ||
    value === 'reservation' ||
    value === 'discovery'
  ) {
    return value;
  }
  throw new TypeError('Expected source role');
}
