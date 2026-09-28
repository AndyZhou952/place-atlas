import type { GooglePlacesTransientClient } from './google-place-discovery.ts';
import { fetchBoundedJson } from './bounded-json-http.ts';
import { failure } from '../../product/application/result.ts';

const searchEndpoint = 'https://places.googleapis.com/v1/places:searchText';
const searchFieldMask = 'places.id,places.displayName,places.formattedAddress';
const detailsFieldMask = 'id,displayName,formattedAddress';
const maximumResponseBytes = 64 * 1024;
const timeoutMs = 8_000;

export type GooglePlacesUsageSku =
  | 'places.search_text.requests'
  | 'places.details.requests';

export interface GooglePlacesUsagePort {
  reserve(input: {
    readonly providerId: 'google-places-new';
    readonly sku: GooglePlacesUsageSku;
    readonly units: 1;
    readonly requests: 1;
    readonly costUsd: number;
    readonly hardRequestLimit: 1000;
    readonly hardUnitLimit: 1000;
    readonly hardCostLimitUsd: number;
  }): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'>;
}

export function createGooglePlacesNewClient(options: {
  readonly apiKey?: string;
  readonly usage?: GooglePlacesUsagePort;
  readonly fetch?: typeof fetch;
}): GooglePlacesTransientClient {
  const apiKey = normalizeSecret(options.apiKey);
  const fetchImpl = options.fetch ?? fetch;
  return {
    async searchText({ query }) {
      if (!apiKey || !options.usage) return unavailable();
      const reserved = await options.usage.reserve({
        providerId: 'google-places-new',
        sku: 'places.search_text.requests',
        units: 1,
        requests: 1,
        costUsd: 0.032,
        hardRequestLimit: 1000,
        hardUnitLimit: 1000,
        hardCostLimitUsd: 32,
      });
      if (reserved !== 'reserved') return unavailable();
      const response = await fetchBoundedJson(
        searchEndpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': searchFieldMask,
          },
          body: JSON.stringify({ textQuery: query, pageSize: 4 }),
        },
        { fetch: fetchImpl, timeoutMs, maximumBytes: maximumResponseBytes },
      );
      if (!response.ok) return unavailable();
      const places = mapSearchResponse(response.value);
      if (!places) return unavailable();
      return {
        ok: true,
        value: { places, hasMore: places.length > 3 },
      };
    },
    async getPlace({ placeId }) {
      if (!apiKey || !options.usage || !validText(placeId, 1, 500)) {
        return unavailable();
      }
      const reserved = await options.usage.reserve({
        providerId: 'google-places-new',
        sku: 'places.details.requests',
        units: 1,
        requests: 1,
        costUsd: 0.017,
        hardRequestLimit: 1000,
        hardUnitLimit: 1000,
        hardCostLimitUsd: 17,
      });
      if (reserved !== 'reserved') return unavailable();
      const response = await fetchBoundedJson(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
        {
          method: 'GET',
          headers: {
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': detailsFieldMask,
          },
        },
        { fetch: fetchImpl, timeoutMs, maximumBytes: maximumResponseBytes },
      );
      if (!response.ok) return unavailable();
      const place = mapPlace(response.value, 1);
      return place && place.placeId === placeId
        ? { ok: true, value: place }
        : unavailable();
    },
  };
}

function mapSearchResponse(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }
  // Google omits the repeated `places` field when a valid search has no hits.
  const providerPlaces = value.places === undefined ? [] : value.places;
  if (!Array.isArray(providerPlaces)) return undefined;
  if (providerPlaces.length > 4) return undefined;
  const places = providerPlaces.map((place, index) =>
    mapPlace(place, providerPlaces.length - index),
  );
  return places.every((place) => place !== undefined)
    ? places.filter((place): place is NonNullable<typeof place> =>
        Boolean(place),
      )
    : undefined;
}

function mapPlace(value: unknown, relevance: number) {
  if (!isRecord(value) || !isRecord(value.displayName)) return undefined;
  const placeId = normalizeText(value.id, 1, 500);
  const name = normalizeText(value.displayName.text, 1, 500);
  const address = normalizeText(value.formattedAddress, 1, 500);
  return placeId && name && address
    ? { placeId, relevance, name, address }
    : undefined;
}

function normalizeSecret(value: unknown): string | undefined {
  return validText(value, 1, 500) ? value : undefined;
}

function normalizeText(value: unknown, minimum: number, maximum: number) {
  if (!validText(value, minimum, maximum)) return undefined;
  return value.normalize('NFC').trim();
}

function validText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return false;
  const normalized = value.normalize('NFC').trim();
  return normalized.length >= minimum && normalized.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unavailable() {
  return failure(
    'dependency_failure',
    'Google place discovery is temporarily unavailable.',
  );
}
