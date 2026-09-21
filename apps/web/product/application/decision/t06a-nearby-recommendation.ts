import type { AtlasItem } from '../catalog/atlas-item.ts';
import type { CatalogRead } from '../catalog/catalog-read.ts';
import { createNearbyRecommendation } from './nearby-recommendation-operation.ts';
import type {
  LocationResolution,
  NearbyRecommendation,
  NearbyRecommendationDependencies,
  TransitRouteEvidence,
  TransitRouteProvider,
} from './nearby-recommendation.ts';
import { distanceInKm } from './geo-distance-policy.ts';

export interface T06aNearbyRecommendationDependencies extends NearbyRecommendationDependencies {
  readonly shortlistLimit: number;
  readonly transitShortlistLimit: number;
}

export function createT06aNearbyRecommendation(
  dependencies: T06aNearbyRecommendationDependencies,
): NearbyRecommendation {
  return {
    async execute(query) {
      let resolution: LocationResolution | undefined;
      const catalog = shortlistCatalog(
        dependencies.catalog,
        () => resolution,
        dependencies.shortlistLimit,
      );
      const locationResolver = {
        async resolve(locationHint: string) {
          resolution =
            await dependencies.locationResolver.resolve(locationHint);
          return resolution;
        },
      };

      return createNearbyRecommendation({
        ...dependencies,
        catalog,
        locationResolver,
        transitRouteProvider: limitTransitEgress(
          dependencies.transitRouteProvider,
          dependencies.transitShortlistLimit,
        ),
      }).execute(query);
    },
  };
}

function shortlistCatalog(
  catalog: CatalogRead,
  readResolution: () => LocationResolution | undefined,
  limit: number,
): CatalogRead {
  return {
    async list(profile) {
      const items = await catalog.list(profile);
      const resolution = readResolution();
      if (resolution?.status !== 'resolved' || !isPositiveInteger(limit)) {
        return [];
      }
      return items
        .filter(hasUsableCatalogCoordinates)
        .map((item) => ({
          item,
          distanceKm: distanceInKm(resolution.location.point, {
            latitude: item.latitude,
            longitude: item.longitude,
          }),
        }))
        .sort((left, right) =>
          left.distanceKm !== right.distanceKm
            ? left.distanceKm - right.distanceKm
            : compareIds(left.item, right.item),
        )
        .slice(0, limit)
        .map(({ item }) => item);
    },
    get: (id) => catalog.get(id),
  };
}

function hasUsableCatalogCoordinates(item: AtlasItem): boolean {
  return (
    item.kind === 'food' &&
    item.verificationStatus === 'verified' &&
    Number.isFinite(item.latitude) &&
    item.latitude >= -90 &&
    item.latitude <= 90 &&
    Number.isFinite(item.longitude) &&
    item.longitude >= -180 &&
    item.longitude <= 180
  );
}

function compareIds(left: AtlasItem, right: AtlasItem): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function limitTransitEgress(
  provider: TransitRouteProvider | undefined,
  limit: number,
): TransitRouteProvider | undefined {
  if (!provider) return undefined;
  let accepted = 0;
  return {
    async transit(origin, destination) {
      if (!isPositiveInteger(limit) || accepted >= limit) {
        return unavailableTransit();
      }
      accepted += 1;
      return provider.transit(origin, destination);
    },
  };
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function unavailableTransit(): TransitRouteEvidence {
  return {
    status: 'unavailable',
    warning: 'Transit route was not requested outside the nearby shortlist.',
  };
}
