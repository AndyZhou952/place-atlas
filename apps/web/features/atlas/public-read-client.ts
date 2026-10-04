import type { AtlasItem, VisitMediaRecord, VisitRecord } from './model';
import { isRestaurantClassification } from '../../product/application/catalog/restaurant-classification.ts';

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
  readonly contentType: string;
  readonly displayUrl: string;
}

interface PublicVisit {
  readonly id: string;
  readonly itemId: string;
  readonly visitedOn: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly displayNote?: string;
  readonly media: readonly PublicMedia[];
}

export async function loadPublicCatalog(
  transport: ReadTransport,
  profile: 'verified_catalog' | 'full_merged_catalog' = 'verified_catalog',
): Promise<readonly AtlasItem[]> {
  const catalog = decodePublicCatalog(
    await getJson<unknown>(
      transport,
      profile === 'full_merged_catalog'
        ? '/api/items?profile=full_merged_catalog'
        : '/api/items',
    ),
  );
  return Promise.all(
    catalog.map(async (item) => {
      if (item.verificationStatus !== 'verified') return item;
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
  if (!verifiedAt && value.verificationStatus !== 'needs_review')
    throw new TypeError('Invalid public catalog item.');
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
    ...(isRestaurantClassification(value.classification)
      ? { classification: value.classification }
      : {}),
    ...(optionalString(value.updatedAt) === undefined
      ? {}
      : { updatedAt: optionalString(value.updatedAt) }),
    verificationStatus,
    verifiedAt: verifiedAt ?? '',
    ...(optionalString(value.officialUrl) === undefined
      ? {}
      : { officialUrl: optionalString(value.officialUrl) }),
    ...(value.openingHours === undefined
      ? {}
      : { openingHours: decodeSourcedText(value.openingHours, 1200) }),
    ...(value.closingNotes === undefined
      ? {}
      : { closingNotes: decodeSourcedText(value.closingNotes, 500) }),
    ...(value.regularClosingDays === undefined
      ? {}
      : {
          regularClosingDays: decodeSourcedText(value.regularClosingDays, 500),
        }),
    ...(isRecord(value.scheduleCheck) &&
    ['known', 'unavailable'].includes(
      String(value.scheduleCheck.openingHours),
    ) &&
    ['known', 'unavailable'].includes(
      String(value.scheduleCheck.regularClosingDays),
    ) &&
    typeof value.scheduleCheck.checkedAt === 'string' &&
    Number.isFinite(Date.parse(value.scheduleCheck.checkedAt))
      ? {
          scheduleCheck: {
            openingHours: value.scheduleCheck.openingHours as
              | 'known'
              | 'unavailable',
            regularClosingDays: value.scheduleCheck.regularClosingDays as
              | 'known'
              | 'unavailable',
            checkedAt: value.scheduleCheck.checkedAt,
          },
        }
      : {}),
    ...(typeof value.googlePlaceId === 'string' &&
    /^[A-Za-z0-9_-]{10,500}$/u.test(value.googlePlaceId)
      ? { googlePlaceId: value.googlePlaceId }
      : {}),
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

function decodeSourcedText(
  value: unknown,
  maxLength: number,
): NonNullable<AtlasItem['openingHours']> {
  if (!isRecord(value)) throw new TypeError('Invalid sourced text.');
  const text = requiredString(value.value);
  const sourceUrl = requiredString(value.sourceUrl);
  const observedAt = requiredString(value.observedAt);
  const url = new URL(sourceUrl);
  if (
    !text.trim() ||
    text.length > maxLength ||
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !Number.isFinite(Date.parse(observedAt))
  )
    throw new TypeError('Invalid sourced text.');
  return { value: text, sourceUrl, observedAt };
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
    createdAt: visit.createdAt ?? visit.visitedOn,
    updatedAt: visit.updatedAt ?? visit.visitedOn,
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
        contentType: media.contentType,
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
