import {
  defineOperationGroup,
  type OperationDefinition,
} from '../atlas-application.ts';
import type {
  AtlasItem,
  CatalogProfile,
  NearbyAtlasItem,
} from '../catalog/atlas-item.ts';
import type { CatalogRead } from '../catalog/catalog-read.ts';
import { failure, success, type Result } from '../result.ts';
import { matchesAtlasQuery } from './search-policy.ts';

export interface SearchCatalogInput {
  readonly query: string;
}

export interface FindNearbyInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly limit: number;
  readonly profile: CatalogProfile;
}

export function createDecisionOperationGroup(catalog: CatalogRead) {
  const searchCatalog: OperationDefinition<
    'catalog.search',
    SearchCatalogInput,
    readonly AtlasItem[],
    'json'
  > = {
    descriptor: {
      key: 'catalog.search',
      resultKind: 'json',
      effect: 'read',
      validate: validateSearchCatalogInput,
    },
    async handle(input) {
      try {
        return success(
          (await catalog.list('verified_catalog')).filter((item) =>
            matchesAtlasQuery(item, input.query),
          ),
        );
      } catch {
        return failure(
          'dependency_failure',
          'Atlas search is temporarily unavailable.',
        );
      }
    },
  };

  const findNearby: OperationDefinition<
    'decision.nearby',
    FindNearbyInput,
    readonly NearbyAtlasItem[],
    'json'
  > = {
    descriptor: {
      key: 'decision.nearby',
      resultKind: 'json',
      effect: 'read',
      validate: validateFindNearbyInput,
    },
    async handle(input) {
      try {
        const visibleItems = await catalog.list(input.profile);
        return success(
          visibleItems
            .map((item, catalogOrder) => ({
              catalogOrder,
              item: {
                id: item.id,
                title: item.title,
                kind: item.kind,
                area: item.area,
                distanceKm: distanceInKm(
                  input.latitude,
                  input.longitude,
                  item.latitude,
                  item.longitude,
                ),
                tabelogScore: item.tabelog?.score,
                reservation: item.reservation,
              },
            }))
            .sort(
              (left, right) =>
                left.item.distanceKm - right.item.distanceKm ||
                left.catalogOrder - right.catalogOrder,
            )
            .slice(0, input.limit)
            .map(({ item }) => item),
        );
      } catch {
        return failure(
          'dependency_failure',
          'Nearby Atlas items are temporarily unavailable.',
        );
      }
    },
  };

  return defineOperationGroup({
    'catalog.search': searchCatalog,
    'decision.nearby': findNearby,
  });
}

function validateSearchCatalogInput(
  input: unknown,
): Result<SearchCatalogInput> {
  if (!isRecord(input) || typeof input.query !== 'string') {
    return failure('invalid_input', 'A search query is required.');
  }
  return success({ query: input.query });
}

function validateFindNearbyInput(input: unknown): Result<FindNearbyInput> {
  if (
    !isRecord(input) ||
    !isCoordinate(input.latitude, -90, 90) ||
    !isCoordinate(input.longitude, -180, 180) ||
    typeof input.limit !== 'number' ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 20 ||
    (input.profile !== 'verified_catalog' &&
      input.profile !== 'full_merged_catalog')
  ) {
    return failure(
      'invalid_input',
      'Valid coordinates, limit, and catalog profile are required.',
    );
  }
  return success({
    latitude: input.latitude,
    longitude: input.longitude,
    limit: input.limit,
    profile: input.profile,
  });
}

function isCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function distanceInKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(latitudeB - latitudeA);
  const longitudeDelta = toRadians(longitudeB - longitudeA);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
