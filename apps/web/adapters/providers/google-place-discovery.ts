import type {
  GooglePlaceDiscoveryCandidate,
  GooglePlaceDiscoveryPort,
} from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { failure, type Result } from '../../product/application/result.ts';

const providerNamespace = 'google-places';
const attribution = {
  label: 'Google Maps',
  url: 'https://maps.google.com/',
} as const;

export interface GooglePlacesTransientPlace {
  readonly placeId: string;
  readonly relevance: number;
  readonly name: string;
  readonly address: string;
}

export interface GooglePlacesTransientClient {
  searchText(input: { readonly query: string }): Promise<
    Result<{
      readonly places: readonly GooglePlacesTransientPlace[];
      readonly hasMore: boolean;
    }>
  >;
  getPlace(input: {
    readonly placeId: string;
  }): Promise<Result<GooglePlacesTransientPlace>>;
}

export function createGooglePlaceDiscoveryAdapter(
  client: GooglePlacesTransientClient,
): GooglePlaceDiscoveryPort {
  return {
    async discover({ query }) {
      const result = await client.searchText({ query });
      if (!result.ok) return result;
      if (!validSearchResult(result.value)) {
        return failure(
          'dependency_failure',
          'Google place discovery returned an invalid response.',
        );
      }
      const ordered = [...result.value.places].sort((left, right) => {
        const relevance = right.relevance - left.relevance;
        if (relevance !== 0) return relevance;
        const leftId = left.placeId.normalize('NFC');
        const rightId = right.placeId.normalize('NFC');
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      });
      return {
        ok: true,
        value: {
          candidates: ordered
            .slice(0, 3)
            .map((place, index) => toCandidate(place, index + 1)),
          hasMore: result.value.hasMore || ordered.length > 3,
        },
      };
    },
    async refetch({ providerNamespace: requestedNamespace, placeId }) {
      if (requestedNamespace !== providerNamespace) {
        return failure(
          'invalid_input',
          'The place identity provider is not supported.',
        );
      }
      const result = await client.getPlace({ placeId });
      if (!result.ok) return result;
      if (!validPlace(result.value) || result.value.placeId !== placeId) {
        return failure(
          'dependency_failure',
          'Place discovery returned a different identity.',
        );
      }
      return { ok: true, value: toCandidate(result.value, 1) };
    },
  };
}

function validSearchResult(value: unknown): value is {
  readonly places: readonly GooglePlacesTransientPlace[];
  readonly hasMore: boolean;
} {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as { places?: unknown }).places) ||
    typeof (value as { hasMore?: unknown }).hasMore !== 'boolean'
  ) {
    return false;
  }
  const places = (value as { places: readonly unknown[] }).places;
  const identities = new Set<string>();
  for (const place of places) {
    if (!validPlace(place)) return false;
    const identity = place.placeId.normalize('NFC').trim();
    if (identities.has(identity)) return false;
    identities.add(identity);
  }
  return true;
}

function validPlace(value: unknown): value is GooglePlacesTransientPlace {
  if (!value || typeof value !== 'object') return false;
  const place = value as Partial<GooglePlacesTransientPlace>;
  return (
    boundedText(place.placeId, 1, 500) &&
    typeof place.relevance === 'number' &&
    Number.isFinite(place.relevance) &&
    boundedText(place.name, 1, 500) &&
    boundedText(place.address, 1, 500)
  );
}

function boundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return false;
  const normalized = value.normalize('NFC').trim();
  return normalized.length >= minimum && normalized.length <= maximum;
}

export function createUnavailableGooglePlaceDiscoveryPort(): GooglePlaceDiscoveryPort {
  const unavailable = () =>
    Promise.resolve(
      failure(
        'dependency_failure',
        'Google place discovery is not configured.',
      ),
    );
  return { discover: unavailable, refetch: unavailable };
}

function toCandidate(
  place: GooglePlacesTransientPlace,
  ordinal: number,
): GooglePlaceDiscoveryCandidate {
  return {
    durableIdentity: {
      providerNamespace,
      placeId: place.placeId.normalize('NFC').trim(),
      ordinal,
    },
    transientPresentation: {
      name: place.name.normalize('NFC').trim(),
      address: place.address.normalize('NFC').trim(),
      attribution,
    },
  };
}
