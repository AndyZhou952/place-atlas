import { classifyCuisines, prefectureOf } from '../shared/cuisine.ts';
import { tabelogListingUrl } from '../shared/text.ts';
import type { Reservation, ReservationPolicy, Restaurant, SourcedText } from '../shared/types.ts';

// Stored `atlas_items.payload_json` has two shapes:
//  - flat items (0.1 seeds and every record written by this version), and
//  - 0.1 Add records whose facts live under `intakeEvidence` (tabelog, reservation, profile).
// Both are read here; nothing rewrites existing rows.

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export interface StoredRow {
  readonly id: string;
  readonly payload_json: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly override_title?: string | null;
  readonly override_description?: string | null;
  readonly overall_rating?: number | null;
  readonly is_favorite?: number | null;
  readonly has_visited?: number | null;
  readonly summary?: string | null;
  readonly visit_count?: number | null;
}

function sourced(value: unknown): SourcedText | undefined {
  const entry = record(value);
  const valueText = text(entry.value);
  const sourceUrl = text(entry.sourceUrl);
  const observedAt = text(entry.observedAt);
  return valueText && sourceUrl && observedAt
    ? { value: valueText, sourceUrl, observedAt }
    : undefined;
}

const LEGACY_POLICY: Record<string, ReservationPolicy> = {
  reservable: 'reservable',
  reservation_required: 'required',
  not_reservable: 'not_reservable',
  advance: 'required',
  'same-day': 'reservable',
  ticketed: 'reservable',
  unavailable: 'not_reservable',
  'walk-in': 'not_reservable',
};

function reservationOf(item: Json, evidence: Json, tabelogUrl?: string): Reservation {
  const source = evidence.reservation ? record(evidence.reservation) : record(item.reservation);
  const known = !evidence.reservation || source.status === 'known';
  const policy: ReservationPolicy = known
    ? ((text(source.policy) as ReservationPolicy | undefined) ??
      LEGACY_POLICY[String(source.mode)] ??
      'unknown')
    : 'unknown';
  const url = text(record(record(evidence.profile).bookingLink).value) ?? text(source.url);
  const note = [text(source.bookingWindowLabel), text(source.releaseNote)]
    .filter(Boolean)
    .join(' · ');
  return {
    policy,
    label: (known && text(source.label)) || '',
    ...(url && url !== tabelogUrl && !url.startsWith('https://tabelog.com/')
      ? { bookingUrl: url }
      : {}),
    ...(note ? { note } : {}),
  };
}

export function toRestaurant(row: StoredRow): Restaurant | undefined {
  let item: Json;
  try {
    item = record(JSON.parse(row.payload_json));
  } catch {
    return undefined;
  }
  const latitude = finite(item.latitude);
  const longitude = finite(item.longitude);
  if (
    item.kind !== 'food' ||
    item.verificationStatus !== 'verified' ||
    latitude === undefined ||
    longitude === undefined
  ) {
    return undefined;
  }
  const evidence = record(item.intakeEvidence);
  const profile = record(evidence.profile);
  const sources = Array.isArray(item.sources) ? item.sources.map(record) : [];
  const sourceUrl = (role: string) => text(sources.find((source) => source.role === role)?.url);
  const tabelogFacts = item.intakeEvidence ? record(evidence.tabelog) : record(item.tabelog);
  const scheduleCheck = record(item.scheduleCheck);
  const openingHours =
    scheduleCheck.openingHours === 'unavailable'
      ? undefined
      : sourced(item.openingHours ?? profile.openingHours);
  const regularClosingDays =
    scheduleCheck.regularClosingDays === 'unavailable'
      ? undefined
      : sourced(item.regularClosingDays ?? profile.regularClosingDays);
  const closingNotes = sourced(item.closingNotes ?? profile.closingNotes);
  const tabelogUrl =
    (tabelogFacts.status !== 'unknown' ? tabelogListingUrl(tabelogFacts.url) : undefined) ??
    tabelogListingUrl(sourceUrl('tabelog')) ??
    [openingHours, regularClosingDays]
      .map((entry) => tabelogListingUrl(entry?.sourceUrl))
      .find(Boolean);
  const score = tabelogFacts.status === 'unknown' ? undefined : finite(tabelogFacts.score);
  const identity = record(evidence.candidateIdentity);
  const googlePlaceId =
    identity.providerNamespace === 'google-places'
      ? text(identity.placeId)
      : text(item.googlePlaceId);
  const ownerFields = record(evidence.ownerFields);
  const tags = strings(item.tags);
  const cuisineLabels =
    [
      item.cuisineLabels,
      record(item.classification).basis && record(record(item.classification).basis).cuisineLabels,
      ownerFields.categories,
      record(profile.categories).value,
    ]
      .map(strings)
      .find((labels) => labels.length) ?? tags;
  const address = text(item.address) ?? '';
  const officialUrl = text(item.officialUrl) ?? sourceUrl('official');
  const comment = text(row.summary);
  return {
    id: row.id,
    title: text(row.override_title) ?? text(item.title) ?? '',
    ...(text(item.alternateTitle) ? { alternateTitle: text(item.alternateTitle) } : {}),
    area: text(item.area) ?? '',
    address,
    description: row.override_description ?? text(item.description) ?? '',
    latitude,
    longitude,
    tags,
    cuisines: classifyCuisines(cuisineLabels),
    ...(prefectureOf(address) ? { prefecture: prefectureOf(address) } : {}),
    ...(tabelogUrl
      ? { tabelog: { url: tabelogUrl, ...(score === undefined ? {} : { score }) } }
      : {}),
    ...(googlePlaceId && /^[A-Za-z0-9_-]{10,500}$/u.test(googlePlaceId) ? { googlePlaceId } : {}),
    ...(officialUrl && !officialUrl.startsWith('https://tabelog.com/') ? { officialUrl } : {}),
    reservation: reservationOf(item, evidence, tabelogUrl),
    ...(openingHours ? { openingHours } : {}),
    ...(regularClosingDays ? { regularClosingDays } : {}),
    ...(closingNotes ? { closingNotes } : {}),
    addedAt: row.created_at,
    updatedAt: text(item.updatedAt) ?? row.updated_at,
    ...(row.overall_rating == null ? {} : { rating: row.overall_rating }),
    favorite: Boolean(row.is_favorite),
    visited: Boolean(row.has_visited) || Number(row.visit_count ?? 0) > 0,
    ...(comment ? { comment } : {}),
  };
}
