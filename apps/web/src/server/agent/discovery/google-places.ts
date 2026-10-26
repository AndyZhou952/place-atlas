// Google Places (New): verifies the typed name as a real place in Japan, re-reads it on select and
// confirm, and fetches the rating. Only the place ID is ever stored; names, addresses and ratings
// are request scoped. Every call is metered against monthly caps.
import type { GooglePlaceDiscoveryCandidate, GooglePlaceDiscoveryPort } from '../add/workflow.ts';
import { prefectureOf } from '../../../shared/cuisine.ts';
import { failure, type Result } from '../../../shared/result.ts';
import { fetchBoundedJson, type UsageReservation } from './quota.ts';

const providerNamespace = 'google-places';
const placesUrl = 'https://places.googleapis.com/v1/places';
const maximumBytes = 64 * 1024;
const timeoutMs = 8_000;

export interface GooglePlacesUsagePort {
  reserve(input: UsageReservation): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'>;
}

export interface GooglePlacesTransientPlace {
  readonly placeId: string;
  readonly relevance: number;
  readonly name: string;
  readonly address: string;
}

export interface GooglePlacesTransientClient {
  searchText(input: {
    readonly query: string;
  }): Promise<
    Result<{ readonly places: readonly GooglePlacesTransientPlace[]; readonly hasMore: boolean }>
  >;
  getPlace(input: { readonly placeId: string }): Promise<Result<GooglePlacesTransientPlace>>;
}

interface ClientOptions {
  readonly apiKey?: string;
  readonly usage?: GooglePlacesUsagePort;
  readonly fetch?: typeof fetch;
}

const caps = {
  'places.search_text.requests': { costUsd: 0.032, hardCostLimitUsd: 32 },
  'places.details.requests': { costUsd: 0.017, hardCostLimitUsd: 17 },
  'places.details_rating.requests': { costUsd: 0.02, hardCostLimitUsd: 20 },
} as const;

/** Reserves quota for one Places call, then makes it; any refusal or failure is unavailable. */
async function call(
  options: ClientOptions,
  sku: keyof typeof caps,
  url: string,
  fieldMask: string,
  body?: unknown,
): Promise<Record<string, unknown> | undefined> {
  const apiKey = validText(options.apiKey, 1, 500) ? options.apiKey : undefined;
  if (!apiKey || !options.usage) return undefined;
  const reserved = await options.usage.reserve({
    providerId: 'google-places-new',
    sku,
    units: 1,
    requests: 1,
    hardRequestLimit: 1000,
    hardUnitLimit: 1000,
    ...caps[sku],
  });
  if (reserved !== 'reserved') return undefined;
  const response = await fetchBoundedJson(
    url,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { fetch: options.fetch ?? fetch, timeoutMs, maximumBytes },
  );
  return response.ok && isRecord(response.value) ? response.value : undefined;
}

export function createGooglePlacesNewClient(options: ClientOptions): GooglePlacesTransientClient {
  return {
    async searchText({ query }) {
      const value = await call(
        options,
        'places.search_text.requests',
        `${placesUrl}:searchText`,
        'places.id,places.displayName,places.formattedAddress',
        { textQuery: query, pageSize: 4 },
      );
      // Google omits the repeated `places` field when a valid search has no hits.
      const listed = value ? (value.places ?? []) : undefined;
      if (!Array.isArray(listed) || listed.length > 4) return unavailable();
      const places = listed.map((place, index) => mapPlace(place, listed.length - index));
      if (!places.every(Boolean)) return unavailable();
      // The atlas covers Japan only.
      const inJapan = (places as GooglePlacesTransientPlace[]).filter((place) =>
        isInJapan(place.address),
      );
      return { ok: true, value: { places: inJapan, hasMore: places.length > 3 } };
    },
    async getPlace({ placeId }) {
      if (!validText(placeId, 1, 500)) return unavailable();
      // The selected place is re-read in Japanese, the language of its Tabelog listing, so research
      // and geocoding compare names and addresses in one script. Search keeps Google's default
      // language: the Owner's Latin words must still anchor its candidates.
      const value = await call(
        options,
        'places.details.requests',
        `${placesUrl}/${encodeURIComponent(placeId)}?languageCode=ja&regionCode=JP`,
        'id,displayName,formattedAddress',
      );
      const place = mapPlace(value, 1);
      return place && place.placeId === placeId ? { ok: true, value: place } : unavailable();
    },
  };
}

/** Rating content is request scoped. Only the place ID may be retained. */
export function createGooglePlaceRatingClient(options: ClientOptions) {
  return {
    async getRating(placeId: string) {
      if (!validText(placeId, 1, 500)) return unavailable();
      const value = await call(
        options,
        'places.details_rating.requests',
        `${placesUrl}/${encodeURIComponent(placeId)}`,
        'id,rating,userRatingCount,googleMapsUri',
      );
      const reviewCount = value?.userRatingCount;
      if (
        !value ||
        value.id !== placeId ||
        typeof value.rating !== 'number' ||
        !Number.isFinite(value.rating) ||
        value.rating < 0 ||
        value.rating > 5 ||
        (reviewCount !== undefined &&
          (typeof reviewCount !== 'number' ||
            !Number.isSafeInteger(reviewCount) ||
            reviewCount < 0)) ||
        typeof value.googleMapsUri !== 'string' ||
        !isGoogleMapsLink(value.googleMapsUri)
      )
        return unavailable();
      return {
        ok: true as const,
        value: {
          score: value.rating,
          ...(reviewCount === undefined ? {} : { reviewCount: reviewCount as number }),
          url: value.googleMapsUri,
        },
      };
    },
  };
}

export function createGooglePlaceDiscoveryAdapter(
  client: GooglePlacesTransientClient,
): GooglePlaceDiscoveryPort {
  return {
    async discover({ query }) {
      const result = await client.searchText({ query });
      if (!result.ok) return result;
      const ids = result.value.places.map((place) => place.placeId.normalize('NFC').trim());
      if (new Set(ids).size !== ids.length)
        return failure(
          'dependency_failure',
          'Google place discovery returned an invalid response.',
        );
      const ordered = result.value.places
        .filter((place) => candidateMatchesQueryAnchors(query, place))
        .sort((left, right) => {
          const relevance = right.relevance - left.relevance;
          if (relevance !== 0) return relevance;
          const leftId = left.placeId.normalize('NFC');
          const rightId = right.placeId.normalize('NFC');
          return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
        });
      return {
        ok: true,
        value: {
          candidates: ordered.slice(0, 3).map((place, index) => toCandidate(place, index + 1)),
          hasMore: result.value.hasMore || ordered.length > 3,
        },
      };
    },
    async refetch({ providerNamespace: requestedNamespace, placeId }) {
      if (requestedNamespace !== providerNamespace)
        return failure('invalid_input', 'The place identity provider is not supported.');
      const result = await client.getPlace({ placeId });
      if (!result.ok) return result;
      if (result.value.placeId !== placeId)
        return failure('dependency_failure', 'Place discovery returned a different identity.');
      return { ok: true, value: toCandidate(result.value, 1) };
    },
  };
}

/** Google writes Japanese addresses with 日本/Japan or at least the prefecture name. */
function isInJapan(address: string): boolean {
  return /日本|\bjapan\b/iu.test(address) || prefectureOf(address) !== undefined;
}

/** A provider's fuzzy hit cannot override an explicit address or long name. */
function candidateMatchesQueryAnchors(query: string, place: GooglePlacesTransientPlace): boolean {
  const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const foldedQuery = fold(query);
  const foldedCandidate = fold(`${place.name} ${place.address}`);
  const numbers = foldedQuery.match(/\d{3,}/gu) ?? [];
  if (numbers.some((number) => !foldedCandidate.includes(number))) return false;
  const words = foldedQuery.match(/[a-z]{2,}/gu) ?? [];
  const significantWords = words.filter((word) => word.length >= 4);
  // A mixed-script or short query still needs one of its explicit Latin anchors in the returned
  // identity/address. Google can otherwise return an unrelated business for a faraway area name.
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query) &&
    significantWords.length > 0 &&
    significantWords.every((word) => !foldedCandidate.includes(word))
  )
    return false;
  if (words.length < 4) return true;
  const matched = words.filter((word) => foldedCandidate.includes(word)).length;
  return matched / words.length >= 0.6;
}

function toCandidate(
  place: GooglePlacesTransientPlace,
  ordinal: number,
): GooglePlaceDiscoveryCandidate {
  const placeId = place.placeId.normalize('NFC').trim();
  const name = place.name.normalize('NFC').trim();
  const address = place.address.normalize('NFC').trim();
  // Maps URLs require both api=1 and a query, even when targeting a place ID.
  const mapsUrl = new URL('https://www.google.com/maps/search/');
  mapsUrl.search = new URLSearchParams({
    api: '1',
    query: `${name} ${address}`,
    query_place_id: placeId,
  }).toString();
  return {
    durableIdentity: { providerNamespace, placeId, ordinal },
    transientPresentation: {
      name,
      address,
      attribution: { label: 'Google Maps', url: mapsUrl.href },
    },
  };
}

function mapPlace(value: unknown, relevance: number): GooglePlacesTransientPlace | undefined {
  if (!isRecord(value) || !isRecord(value.displayName)) return undefined;
  const text = (field: unknown) =>
    validText(field, 1, 500) ? field.normalize('NFC').trim() : undefined;
  const placeId = text(value.id);
  const name = text(value.displayName.text);
  const address = text(value.formattedAddress);
  return placeId && name && address ? { placeId, relevance, name, address } : undefined;
}

function isGoogleMapsLink(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ((url.hostname === 'www.google.com' && url.pathname.startsWith('/maps/')) ||
        url.hostname === 'maps.google.com')
    );
  } catch {
    return false;
  }
}

function validText(value: unknown, minimum: number, maximum: number): value is string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return false;
  const normalized = value.normalize('NFC').trim();
  return normalized.length >= minimum && normalized.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unavailable() {
  return failure('dependency_failure', 'Google place discovery is temporarily unavailable.');
}
