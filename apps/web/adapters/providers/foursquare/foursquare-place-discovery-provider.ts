import { failure, success } from '../../../product/application/result.ts';
import type {
  PlaceDiscoveryProvider,
  PlaceDiscoveryRequest,
  PlaceDiscoveryResult,
} from '../../../product/application/catalog-intake/place-discovery.ts';
import type { ProviderPolicyGateway } from '../../../product/provider-policy/provider-policy-gateway.ts';
import {
  mapFoursquarePolicyFields,
  type FoursquarePlaceFields,
} from './foursquare-place-discovery-mapper.ts';

const providerId = 'foursquare-places-api-new';
const maximumCandidates = 3;

export interface FoursquarePlaceDiscoveryProviderOptions {
  readonly gateway: Pick<ProviderPolicyGateway, 'invoke'>;
  readonly clock: { now(): string };
  readonly estimatedCostUsd: number;
}

export function createFoursquarePlaceDiscoveryProvider({
  gateway,
  clock,
  estimatedCostUsd,
}: FoursquarePlaceDiscoveryProviderOptions): PlaceDiscoveryProvider {
  return {
    async discover(request) {
      const query = normalizeRequest(request);
      if (!query) {
        return failure('invalid_input', 'A place name is required.');
      }
      try {
        const result = await gateway.invoke({
          providerId,
          credentialScope: 'places.search',
          method: 'GET',
          url: createSearchUrl(query),
          fields: [
            { name: 'fsqPlaceId', use: 'durable' },
            { name: 'name', use: 'durable' },
            { name: 'formattedAddress', use: 'durable' },
            { name: 'coordinates', use: 'durable' },
            { name: 'rating', use: 'chat', whenDenied: 'unknown' },
          ],
          cache: { mode: 'request_only' },
          estimatedCostUsd,
        });
        if (
          !result.ok ||
          !result.value.attribution ||
          result.value.attribution.label !== 'Foursquare'
        ) {
          return unavailable();
        }
        const fields = mapFoursquarePolicyFields(result.value.fields);
        if (!fields) return unavailable();
        const checkedAt = clock.now();
        return success(
          toDiscoveryResult(fields, result.value.sourceUrl, checkedAt),
        );
      } catch {
        return unavailable();
      }
    },
  };
}

function normalizeRequest(
  request: PlaceDiscoveryRequest,
): { readonly name: string; readonly near?: string } | undefined {
  const name = request.name.trim();
  if (!name) return undefined;
  const near = request.near?.trim();
  return near ? { name, near } : { name };
}

function createSearchUrl(request: {
  readonly name: string;
  readonly near?: string;
}): string {
  const url = new URL('https://places-api.foursquare.com/places/search');
  url.searchParams.set('query', request.name);
  if (request.near) url.searchParams.set('near', request.near);
  return url.href;
}

function toDiscoveryResult(
  fields: FoursquarePlaceFields,
  sourceUrl: string,
  checkedAt: string,
): PlaceDiscoveryResult {
  return {
    candidates: fields.fsqPlaceId
      .slice(0, maximumCandidates)
      .map((id, index) => {
        const name = fields.name[index];
        const address = fields.formattedAddress[index];
        const coordinates = fields.coordinates[index];
        if (!name || !address || !coordinates) {
          throw new TypeError('Foursquare candidate fields are incomplete.');
        }
        return {
          strongIdentity: { providerNamespace: providerId, stablePlaceId: id },
          name: { value: name, sourceUrl, checkedAt },
          address: { value: address, sourceUrl, checkedAt },
          coordinates: { value: coordinates, sourceUrl, checkedAt },
          externalRating: { status: 'unknown', reason: 'not_permitted' },
          source: { providerId, sourceUrl, checkedAt },
        };
      }),
  };
}

function unavailable() {
  return failure(
    'dependency_failure',
    'Place discovery is temporarily unavailable.',
  );
}
