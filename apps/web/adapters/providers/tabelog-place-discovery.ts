import { createWebSearch } from '../../agent/web-search.ts';
import { isTabelogRestaurantListing } from '../../agent/research-instructions.ts';
import { readTabelogListing } from '../../agent/tabelog-listing.ts';
import type {
  GooglePlaceDiscoveryCandidate,
  GooglePlaceDiscoveryPort,
} from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { failure } from '../../product/application/result.ts';

/** Japan-only discovery without a search or Maps key. Never derive identity from snippets. */
export function createTabelogPlaceDiscoveryPort(
  options: {
    fetch?: typeof fetch;
    searchApiKey?: string;
  } = {},
): GooglePlaceDiscoveryPort {
  const fetcher = options.fetch ?? fetch;
  const search = createWebSearch({
    fetch: fetcher,
    apiKey: options.searchApiKey,
  });

  async function read(placeId: string, ordinal: number, signal: AbortSignal) {
    const listing = await readTabelogListing(placeId, fetcher, signal);
    const restaurant = listing?.restaurant;
    if (
      !restaurant ||
      !boundedText(restaurant.name) ||
      !boundedText(restaurant.address)
    )
      return undefined;
    return {
      durableIdentity: { providerNamespace: 'tabelog', placeId, ordinal },
      transientPresentation: {
        name: restaurant.name.trim(),
        address: restaurant.address.trim(),
        attribution: { label: 'Tabelog', url: placeId },
      },
    } satisfies GooglePlaceDiscoveryCandidate;
  }

  return {
    async discover({ query }) {
      if (!boundedText(query) || query.trim().length > 475) {
        return failure(
          'invalid_input',
          'Enter a restaurant name, neighborhood, or Tabelog listing.',
        );
      }
      const signal = AbortSignal.timeout(12_000);
      const direct = canonicalListing(query.trim());
      let urls: string[];
      if (direct) {
        urls = [direct];
      } else {
        const result = await search.search(
          `${query.trim()} site:tabelog.com`,
          signal,
        );
        if (result.kind === 'unavailable') {
          return failure(
            'dependency_failure',
            'Restaurant search is temporarily unavailable. Please retry or configure a Maps key.',
          );
        }
        urls = [
          ...new Set(
            result.sources
              .map((source) => canonicalListing(source.url))
              .filter((url): url is string => !!url),
          ),
        ];
      }
      const rows = await Promise.all(
        urls.slice(0, 3).map((url, index) => read(url, index + 1, signal)),
      );
      const candidates = rows
        .filter((row): row is GooglePlaceDiscoveryCandidate => !!row)
        .map((row, index) => ({
          ...row,
          durableIdentity: { ...row.durableIdentity, ordinal: index + 1 },
        }));
      if (urls.length && !candidates.length) {
        return failure(
          'dependency_failure',
          'Restaurant listings could not be read. Please retry; no restaurant has been saved.',
        );
      }
      // Search exposes only its top three. Do not claim a chain has only these branches.
      return {
        ok: true,
        value: { candidates, hasMore: !direct && urls.length >= 3 },
      };
    },
    async refetch({ providerNamespace, placeId }) {
      if (
        providerNamespace !== 'tabelog' ||
        canonicalListing(placeId) !== placeId
      ) {
        return failure(
          'invalid_input',
          'The restaurant listing identity is not supported.',
        );
      }
      const candidate = await read(placeId, 1, AbortSignal.timeout(6000));
      if (!candidate)
        return failure(
          'dependency_failure',
          'The selected restaurant listing is temporarily unavailable.',
        );
      return { ok: true, value: candidate };
    },
  };
}

function canonicalListing(value: string): string | undefined {
  if (!isTabelogRestaurantListing(value)) return undefined;
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  url.pathname = `${url.pathname.replace(/^\/(?:en|cn|tw|kr)\//u, '/').replace(/\/$/u, '')}/`;
  return url.href;
}

function boundedText(value: string): boolean {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    value.trim().length <= 500 &&
    !/\p{Cc}/u.test(value)
  );
}
