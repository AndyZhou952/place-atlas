import type { AtlasItem, VisitMediaRecord, VisitRecord } from './model';
import type { OwnerReviewCandidateView } from './owner-review-candidate-view';
import { publishOwnerLoginRequired } from './owner-session-client.ts';

export class OwnerAuthenticationRequiredError extends Error {
  readonly code = 'auth_required' as const;

  constructor() {
    super('Owner login is required.');
    this.name = 'OwnerAuthenticationRequiredError';
  }
}

interface ReadTransport {
  request(url: string, init?: RequestInit): Promise<Response>;
}

interface PublicAssessment {
  readonly favorite: boolean;
  readonly effectiveVisited: boolean;
  readonly personalRating?: number;
  readonly overallComment?: string;
}

interface PublicMedia {
  readonly id: string;
  readonly visitId: string;
  readonly displayOrder: number;
  readonly caption?: string;
  readonly displayUrl: string;
}

interface PublicVisit {
  readonly id: string;
  readonly itemId: string;
  readonly visitedOn: string;
  readonly displayNote?: string;
  readonly media: readonly PublicMedia[];
}

export async function loadPublicCatalog(
  transport: ReadTransport,
): Promise<readonly AtlasItem[]> {
  const catalog = decodePublicCatalog(
    await getJson<unknown>(transport, '/api/items'),
  );
  return Promise.all(
    catalog.map(async (item) => {
      if (!item.reservation) return item;
      const assessment = await getJson<PublicAssessment>(
        transport,
        `/api/items/${encodeURIComponent(item.id)}/personal`,
      );
      return {
        ...item,
        verifiedAt: item.verifiedAt ?? item.reservation.checkedAt,
        personalState: assessment.effectiveVisited
          ? 'visited'
          : assessment.favorite
            ? 'saved'
            : 'candidate',
        personalRating: assessment.personalRating,
        overallComment: assessment.overallComment,
        isFavorite: assessment.favorite,
        hasVisited: assessment.effectiveVisited,
      };
    }),
  );
}

export async function loadOwnerReviewCandidates(
  transport: ReadTransport,
): Promise<readonly OwnerReviewCandidateView[]> {
  const response = await transport.request(
    '/api/owner/catalog/review-candidates',
    { headers: { 'content-type': 'application/json' } },
  );
  if (response.status === 401) {
    publishOwnerLoginRequired();
    throw new OwnerAuthenticationRequiredError();
  }
  if (!response.ok) {
    throw new Error(
      (await response.text()) || `Request failed (${response.status})`,
    );
  }
  const value: unknown = await response.json();
  if (!Array.isArray(value)) {
    throw new TypeError('Invalid Owner Review Candidate list.');
  }
  return value.map(decodeOwnerReviewCandidate);
}

function decodeOwnerReviewCandidate(value: unknown): OwnerReviewCandidateView {
  if (!isRecord(value)) {
    throw new TypeError('Invalid Owner Review Candidate.');
  }
  const allowed = new Set([
    'recordType',
    'id',
    'kind',
    'title',
    'description',
    'verificationStatus',
    'area',
    'location',
    'tabelog',
    'reservation',
    'unknownFields',
    'warnings',
    'personalState',
    'personalRating',
    'isFavorite',
    'hasVisited',
    'tags',
    'updatedAt',
  ]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.recordType !== 'review_candidate' ||
    value.kind !== 'food' ||
    value.verificationStatus !== 'needs_review'
  ) {
    throw new TypeError('Invalid Owner Review Candidate discriminant.');
  }
  const personalState = value.personalState;
  if (
    personalState !== 'candidate' &&
    personalState !== 'saved' &&
    personalState !== 'visited'
  ) {
    throw new TypeError('Invalid Owner Review Candidate state.');
  }
  return {
    id: requiredString(value.id),
    title: requiredString(value.title),
    description: requiredString(value.description),
    area: decodeCandidateArea(value.area),
    location: decodeCandidateLocation(value.location),
    tabelog: decodeCandidateTabelog(value.tabelog),
    reservation: decodeCandidateReservation(value.reservation),
    unknownFields: stringArray(value.unknownFields),
    warnings: decodeCandidateWarnings(value.warnings),
    personalState,
    ...(value.personalRating === undefined
      ? {}
      : { personalRating: finiteNumber(value.personalRating) }),
    ...(value.isFavorite === undefined
      ? {}
      : { isFavorite: booleanValue(value.isFavorite) }),
    ...(value.hasVisited === undefined
      ? {}
      : { hasVisited: booleanValue(value.hasVisited) }),
    tags: stringArray(value.tags),
    updatedAt: requiredString(value.updatedAt),
  };
}

function decodeCandidateArea(value: unknown): OwnerReviewCandidateView['area'] {
  if (
    !isRecord(value) ||
    (value.status !== 'known' && value.status !== 'unknown')
  ) {
    throw new TypeError('Invalid Review Candidate area.');
  }
  if (value.status === 'unknown') {
    requireExactKeys(value, ['status']);
    return { status: 'unknown' };
  }
  requireExactKeys(value, ['status', 'value']);
  return { status: 'known', value: requiredString(value.value) };
}

function decodeCandidateLocation(
  value: unknown,
): OwnerReviewCandidateView['location'] {
  if (
    !isRecord(value) ||
    (value.status !== 'known' && value.status !== 'unknown')
  ) {
    throw new TypeError('Invalid Review Candidate location.');
  }
  if (value.status === 'unknown') {
    requireExactKeys(value, ['status']);
    return { status: 'unknown' };
  }
  const coordinates = value.coordinates;
  if (!isRecord(coordinates)) {
    throw new TypeError('Invalid Review Candidate coordinates.');
  }
  requireExactKeys(coordinates, ['latitude', 'longitude']);
  const shared = {
    status: 'known' as const,
    address: requiredString(value.address),
    coordinates: {
      latitude: finiteNumber(coordinates.latitude),
      longitude: finiteNumber(coordinates.longitude),
    },
  };
  if (value.provenance === 'owner_asserted') {
    requireExactKeys(
      value,
      [
        'status',
        'address',
        'coordinates',
        'provenance',
        'sourceUrl',
        'assertedAt',
      ],
      ['sourceUrl'],
    );
    return {
      ...shared,
      provenance: 'owner_asserted',
      ...(value.sourceUrl === undefined
        ? {}
        : { sourceUrl: requiredString(value.sourceUrl) }),
      assertedAt: requiredString(value.assertedAt),
    };
  }
  if (value.provenance === 'agent_observed') {
    requireExactKeys(value, [
      'status',
      'address',
      'coordinates',
      'provenance',
      'sourceUrl',
      'observedAt',
    ]);
    return {
      ...shared,
      provenance: 'agent_observed',
      sourceUrl: requiredString(value.sourceUrl),
      observedAt: requiredString(value.observedAt),
    };
  }
  if (value.provenance !== 'durable_geocoder_observed') {
    throw new TypeError('Invalid Review Candidate location provenance.');
  }
  requireExactKeys(value, [
    'status',
    'address',
    'coordinates',
    'provenance',
    'sourceUrl',
    'checkedAt',
    'provider',
    'license',
  ]);
  return {
    ...shared,
    provenance: 'durable_geocoder_observed',
    sourceUrl: requiredString(value.sourceUrl),
    checkedAt: requiredString(value.checkedAt),
    provider: requiredString(value.provider),
    license: requiredString(value.license),
  };
}

function decodeCandidateTabelog(
  value: unknown,
): OwnerReviewCandidateView['tabelog'] {
  if (
    !isRecord(value) ||
    (value.status !== 'known' && value.status !== 'unknown')
  ) {
    throw new TypeError('Invalid Review Candidate Tabelog evidence.');
  }
  if (value.status === 'unknown') {
    requireExactKeys(value, ['status']);
    return { status: 'unknown' };
  }
  const shared = decodeObservedEvidenceShared(value, ['score', 'reviewCount']);
  const result = {
    status: 'known' as const,
    score: finiteNumber(value.score),
    ...(value.reviewCount === undefined
      ? {}
      : { reviewCount: finiteNumber(value.reviewCount) }),
    url: shared.url,
    freshness: shared.freshness,
  };
  return value.provenance === 'owner_asserted'
    ? {
        ...result,
        provenance: 'owner_asserted',
        assertedAt: requiredString(value.assertedAt),
      }
    : {
        ...result,
        provenance: 'agent_observed',
        observedAt: requiredString(value.observedAt),
      };
}

function decodeCandidateReservation(
  value: unknown,
): OwnerReviewCandidateView['reservation'] {
  if (
    !isRecord(value) ||
    (value.status !== 'known' && value.status !== 'unknown')
  ) {
    throw new TypeError('Invalid Review Candidate reservation evidence.');
  }
  if (value.status === 'unknown') {
    requireExactKeys(value, ['status']);
    return { status: 'unknown' };
  }
  const mode = value.mode;
  if (
    mode !== 'reservable' &&
    mode !== 'reservation_required' &&
    mode !== 'not_reservable'
  ) {
    throw new TypeError('Invalid Review Candidate reservation mode.');
  }
  const optional = [
    'advanceDays',
    'bookingWindowLabel',
    'releaseNote',
    'channel',
  ];
  const shared = decodeObservedEvidenceShared(value, [
    'mode',
    'label',
    ...optional,
  ]);
  const result = {
    status: 'known' as const,
    mode: mode as 'reservable' | 'reservation_required' | 'not_reservable',
    label: requiredString(value.label),
    ...(value.advanceDays === undefined
      ? {}
      : { advanceDays: finiteNumber(value.advanceDays) }),
    ...(value.bookingWindowLabel === undefined
      ? {}
      : { bookingWindowLabel: requiredString(value.bookingWindowLabel) }),
    ...(value.releaseNote === undefined
      ? {}
      : { releaseNote: requiredString(value.releaseNote) }),
    ...(value.channel === undefined
      ? {}
      : { channel: requiredString(value.channel) }),
    url: shared.url,
    freshness: shared.freshness,
  };
  return value.provenance === 'owner_asserted'
    ? {
        ...result,
        provenance: 'owner_asserted',
        assertedAt: requiredString(value.assertedAt),
      }
    : {
        ...result,
        provenance: 'agent_observed',
        observedAt: requiredString(value.observedAt),
      };
}

function decodeObservedEvidenceShared(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): { readonly url: string; readonly freshness: 'fresh' | 'stale' } {
  const freshness = value.freshness;
  if (freshness !== 'fresh' && freshness !== 'stale') {
    throw new TypeError('Invalid evidence freshness.');
  }
  const provenance = value.provenance;
  const timeField =
    provenance === 'owner_asserted'
      ? 'assertedAt'
      : provenance === 'agent_observed'
        ? 'observedAt'
        : undefined;
  if (!timeField) throw new TypeError('Invalid evidence provenance.');
  requireExactKeys(
    value,
    ['status', ...fields, 'url', 'freshness', 'provenance', timeField],
    fields.filter((field) =>
      [
        'reviewCount',
        'advanceDays',
        'bookingWindowLabel',
        'releaseNote',
        'channel',
      ].includes(field),
    ),
  );
  requiredString(value[timeField]);
  return { url: requiredString(value.url), freshness };
}

function decodeCandidateWarnings(
  value: unknown,
): OwnerReviewCandidateView['warnings'] {
  if (!Array.isArray(value)) throw new TypeError('Invalid candidate warnings.');
  return value.map((warning) => {
    if (!isRecord(warning)) throw new TypeError('Invalid candidate warning.');
    requireExactKeys(warning, ['code', 'message']);
    return {
      code: requiredString(warning.code),
      message: requiredString(warning.message),
    };
  });
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowedSet = new Set(allowed);
  if (
    Object.keys(value).some((key) => !allowedSet.has(key)) ||
    allowed.some((key) => !optional.includes(key) && !(key in value))
  ) {
    throw new TypeError('Unexpected candidate DTO fields.');
  }
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Expected boolean.');
  return value;
}

function decodePublicCatalog(value: unknown): readonly AtlasItem[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid public catalog.');
  return value.map(decodePublicCatalogItem);
}

function decodePublicCatalogItem(value: unknown): AtlasItem {
  if (!isRecord(value)) throw new TypeError('Invalid public catalog item.');
  const reservationEvidence = value.reservation;
  if (!isRecord(reservationEvidence)) {
    throw new TypeError('Invalid reservation evidence.');
  }
  const evidenceShape =
    reservationEvidence.status === 'known' ||
    reservationEvidence.status === 'unknown'
      ? 'intake_v1'
      : 'legacy';
  const reservation = decodeReservation(value.reservation, evidenceShape);
  const verifiedAt =
    optionalString(value.verifiedAt) ?? reservation.legacyCheckedAt;
  if (!verifiedAt) throw new TypeError('Invalid public catalog item.');
  const kind = value.kind;
  const verificationStatus = value.verificationStatus;
  if (
    (kind !== 'food' && kind !== 'event' && kind !== 'architecture') ||
    (verificationStatus !== 'verified' && verificationStatus !== 'needs_review')
  ) {
    throw new TypeError('Invalid public catalog item.');
  }
  return {
    id: requiredString(value.id),
    kind,
    title: requiredString(value.title),
    ...(optionalString(value.alternateTitle) === undefined
      ? {}
      : { alternateTitle: optionalString(value.alternateTitle) }),
    area: requiredString(value.area),
    address: requiredString(value.address),
    description: requiredString(value.description),
    latitude: finiteNumber(value.latitude),
    longitude: finiteNumber(value.longitude),
    verificationStatus,
    verifiedAt,
    ...(optionalString(value.officialUrl) === undefined
      ? {}
      : { officialUrl: optionalString(value.officialUrl) }),
    ...(value.googleRating === undefined
      ? {}
      : { googleRating: decodeTabelog(value.googleRating, 'legacy') }),
    ...(value.tabelog === undefined
      ? {}
      : { tabelog: decodeTabelog(value.tabelog, evidenceShape) }),
    reservation: reservation.value,
    ...(value.event === undefined ? {} : { event: decodeEvent(value.event) }),
    personalState: 'candidate',
    tags: stringArray(value.tags),
    sources: decodeSources(value.sources),
  };
}

function decodeTabelog(
  value: unknown,
  evidenceShape: 'legacy' | 'intake_v1',
): AtlasItem['tabelog'] {
  if (!isRecord(value)) throw new TypeError('Invalid Tabelog evidence.');
  if (
    (evidenceShape === 'intake_v1' && value.status !== 'known') ||
    (evidenceShape === 'legacy' && value.status !== undefined)
  ) {
    throw new TypeError('Invalid Tabelog evidence model.');
  }
  const checkedAt = evidenceTime(value);
  return {
    score: finiteNumber(value.score),
    ...(value.reviewCount === undefined
      ? {}
      : { reviewCount: finiteNumber(value.reviewCount) }),
    url: requiredString(value.url),
    checkedAt,
  };
}

function decodeReservation(
  value: unknown,
  evidenceShape: 'legacy' | 'intake_v1',
): {
  readonly value: AtlasItem['reservation'];
  readonly legacyCheckedAt?: string;
} {
  if (!isRecord(value)) throw new TypeError('Invalid reservation evidence.');
  if (
    (evidenceShape === 'intake_v1' &&
      value.status !== 'known' &&
      value.status !== 'unknown') ||
    (evidenceShape === 'legacy' && value.status !== undefined)
  ) {
    throw new TypeError('Invalid reservation evidence model.');
  }
  if (value.status === 'unknown') {
    return { value: { mode: 'unknown', label: 'Unknown' } };
  }
  if (value.status === 'known') {
    const mode = value.mode;
    if (
      mode !== 'reservable' &&
      mode !== 'reservation_required' &&
      mode !== 'not_reservable'
    ) {
      throw new TypeError('Invalid reservation evidence.');
    }
    return {
      value: {
        mode: mode === 'not_reservable' ? 'unavailable' : 'advance',
        label: requiredString(value.label),
        ...(optionalString(value.channel) === undefined
          ? {}
          : { channel: optionalString(value.channel) }),
        url: requiredString(value.url),
        ...(value.advanceDays === undefined
          ? {}
          : { advanceDays: finiteNumber(value.advanceDays) }),
        ...(optionalString(value.bookingWindowLabel) === undefined
          ? {}
          : { bookingWindowLabel: optionalString(value.bookingWindowLabel) }),
        ...(optionalString(value.releaseNote) === undefined
          ? {}
          : { releaseNote: optionalString(value.releaseNote) }),
        checkedAt: evidenceTime(value),
      },
    };
  }
  const mode = value.mode;
  if (
    mode !== 'walk-in' &&
    mode !== 'same-day' &&
    mode !== 'advance' &&
    mode !== 'ticketed' &&
    mode !== 'unavailable' &&
    mode !== 'unknown'
  ) {
    throw new TypeError('Invalid reservation evidence.');
  }
  const checkedAt = optionalString(value.checkedAt);
  return {
    value: {
      mode,
      label: requiredString(value.label),
      ...(optionalString(value.channel) === undefined
        ? {}
        : { channel: optionalString(value.channel) }),
      ...(optionalString(value.url) === undefined
        ? {}
        : { url: optionalString(value.url) }),
      ...(value.advanceDays === undefined
        ? {}
        : { advanceDays: finiteNumber(value.advanceDays) }),
      ...(optionalString(value.bookingWindowLabel) === undefined
        ? {}
        : { bookingWindowLabel: optionalString(value.bookingWindowLabel) }),
      ...(optionalString(value.releaseNote) === undefined
        ? {}
        : { releaseNote: optionalString(value.releaseNote) }),
      ...(checkedAt === undefined ? {} : { checkedAt }),
    },
    ...(checkedAt === undefined ? {} : { legacyCheckedAt: checkedAt }),
  };
}

function evidenceTime(value: Readonly<Record<string, unknown>>): string {
  if (value.provenance === 'owner_asserted') {
    return requiredString(value.assertedAt);
  }
  if (value.provenance === 'agent_observed') {
    return requiredString(value.observedAt);
  }
  return requiredString(value.checkedAt);
}

function decodeEvent(value: unknown): NonNullable<AtlasItem['event']> {
  if (!isRecord(value)) throw new TypeError('Invalid event.');
  return {
    startDate: requiredString(value.startDate),
    endDate: requiredString(value.endDate),
    displayDate: requiredString(value.displayDate),
  };
}

function decodeSources(value: unknown): AtlasItem['sources'] {
  if (!Array.isArray(value)) throw new TypeError('Invalid sources.');
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.url !== 'string') return [];
    const role = entry.role;
    if (
      role !== 'official' &&
      role !== 'tabelog' &&
      role !== 'reservation' &&
      role !== 'discovery'
    ) {
      return [];
    }
    return [
      {
        label: requiredString(entry.label),
        url: entry.url,
        role,
      },
    ];
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Expected string.');
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value);
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Expected finite number.');
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string')
  ) {
    throw new TypeError('Expected string array.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function loadPublicVisits(
  transport: ReadTransport,
): Promise<readonly VisitRecord[]> {
  const visits = await getJson<readonly PublicVisit[]>(
    transport,
    '/api/journal',
  );
  const titles = new Map<string, string>();
  await Promise.all(
    [...new Set(visits.map((visit) => visit.itemId))].map(async (itemId) => {
      const item = await getJson<Pick<AtlasItem, 'title'>>(
        transport,
        `/api/items/${encodeURIComponent(itemId)}`,
      );
      titles.set(itemId, item.title);
    }),
  );
  return visits.map((visit) => ({
    id: visit.id,
    itemId: visit.itemId,
    itemTitle: titles.get(visit.itemId) ?? visit.itemId,
    visitedAt: visit.visitedOn,
    note: visit.displayNote,
    createdAt: visit.visitedOn,
    updatedAt: visit.visitedOn,
  }));
}

export async function loadPublicMedia(
  transport: ReadTransport,
  filters: { readonly visitId?: string; readonly itemId?: string },
): Promise<readonly VisitMediaRecord[]> {
  const search = new URLSearchParams();
  if (filters.visitId) search.set('visitId', filters.visitId);
  if (filters.itemId) search.set('itemId', filters.itemId);
  const privateResponse = await transport.request(
    `/api/media${search.size ? `?${search.toString()}` : ''}`,
    { headers: { 'content-type': 'application/json' } },
  );
  if (privateResponse.ok) {
    return (await privateResponse.json()) as readonly VisitMediaRecord[];
  }
  if (privateResponse.status !== 401) {
    throw new Error(
      (await privateResponse.text()) ||
        `Request failed (${privateResponse.status})`,
    );
  }

  const visits = await getJson<readonly PublicVisit[]>(
    transport,
    '/api/journal',
  );
  return visits.flatMap((visit) =>
    visit.media
      .filter(
        (media) =>
          (!filters.visitId || media.visitId === filters.visitId) &&
          (!filters.itemId || visit.itemId === filters.itemId),
      )
      .map((media) => ({
        id: media.id,
        visitId: media.visitId,
        itemId: visit.itemId,
        originalFilename: 'Photo',
        caption: media.caption,
        displayOrder: media.displayOrder,
        contentUrl: media.displayUrl,
      })),
  );
}

async function getJson<T>(transport: ReadTransport, url: string): Promise<T> {
  const response = await transport.request(url, {
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      (await response.text()) || `Request failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}
