import type {
  GooglePlaceDiscoveryCandidate,
  GooglePlaceDiscoveryPort,
} from '../add/coordinator.ts';
import { failure, type Result } from '../../../shared/result.ts';

const providerNamespace = 'google-places';

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
  getPlace(input: { readonly placeId: string }): Promise<Result<GooglePlacesTransientPlace>>;
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
      if (requestedNamespace !== providerNamespace) {
        return failure('invalid_input', 'The place identity provider is not supported.');
      }
      const result = await client.getPlace({ placeId });
      if (!result.ok) return result;
      if (!validPlace(result.value) || result.value.placeId !== placeId) {
        return failure('dependency_failure', 'Place discovery returned a different identity.');
      }
      return { ok: true, value: toCandidate(result.value, 1) };
    },
  };
}

/** A provider's fuzzy hit cannot override an explicit address or long name. */
function candidateMatchesQueryAnchors(query: string, place: GooglePlacesTransientPlace): boolean {
  const foldedQuery = foldForMatch(query);
  const foldedCandidate = foldForMatch(`${place.name} ${place.address}`);
  const numbers = foldedQuery.match(/\d{3,}/gu) ?? [];
  if (numbers.some((number) => !foldedCandidate.includes(number))) {
    return false;
  }
  const words = foldedQuery.match(/[a-z]{2,}/gu) ?? [];
  const significantWords = words.filter((word) => word.length >= 4);
  // A mixed-script or short query still needs at least one of its explicit
  // Latin anchors in the returned identity/address. Google can otherwise
  // return an unrelated local business for a faraway area name.
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query) &&
    significantWords.length > 0 &&
    significantWords.every((word) => !foldedCandidate.includes(word))
  ) {
    return false;
  }
  if (words.length < 4) return true;
  const matched = words.filter((word) => foldedCandidate.includes(word)).length;
  return matched / words.length >= 0.6;
}

function foldForMatch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
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

function boundedText(value: unknown, minimum: number, maximum: number): value is string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return false;
  const normalized = value.normalize('NFC').trim();
  return normalized.length >= minimum && normalized.length <= maximum;
}

export function createUnavailableGooglePlaceDiscoveryPort(): GooglePlaceDiscoveryPort {
  const unavailable = () =>
    Promise.resolve(failure('dependency_failure', 'Google place discovery is not configured.'));
  return { discover: unavailable, refetch: unavailable };
}

function toCandidate(
  place: GooglePlacesTransientPlace,
  ordinal: number,
): GooglePlaceDiscoveryCandidate {
  const placeId = place.placeId.normalize('NFC').trim();
  const name = place.name.normalize('NFC').trim();
  const address = place.address.normalize('NFC').trim();
  // Maps URLs require both api=1 and a query, even when targeting a place ID.
  // The name and address also identify the branch if Maps cannot resolve the ID.
  const mapsUrl = new URL('https://www.google.com/maps/search/');
  mapsUrl.search = new URLSearchParams({
    api: '1',
    query: `${name} ${address}`,
    query_place_id: placeId,
  }).toString();
  return {
    durableIdentity: {
      providerNamespace,
      placeId,
      ordinal,
    },
    transientPresentation: {
      name,
      address,
      attribution: {
        label: 'Google Maps',
        url: mapsUrl.href,
      },
    },
  };
}
