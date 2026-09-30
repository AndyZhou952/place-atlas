import { failure, success } from '../result.ts';
import type {
  LocationResolution,
  NearbyRecommendation,
  NearbyRecommendationDependencies,
  TransitRouteEvidence,
  TransitRouteProvider,
  WalkingRouteEvidence,
  WalkingRecommendation,
} from './nearby-recommendation.ts';
import { distanceInKm } from './geo-distance-policy.ts';
import { buildDistanceCandidates } from './nearby-distance-fallback.ts';
import { buildDirectTransitCandidates } from './nearby-transit-fallback.ts';

const maximumWalkingDurationSeconds = 15 * 60;
const maximumRecommendations = 5;

export function createNearbyRecommendation({
  catalog,
  locationResolver,
  routeProvider,
  transitRouteProvider,
  clock,
  routeEvidenceMaximumAgeMs,
}: NearbyRecommendationDependencies): NearbyRecommendation {
  return {
    async execute(query) {
      const locationHint = query.locationHint.trim();
      if (locationHint.length === 0) {
        return failure('invalid_input', 'A location is required.');
      }

      let resolution: LocationResolution;
      try {
        resolution = await locationResolver.resolve(locationHint);
      } catch {
        return failure(
          'dependency_failure',
          'Address lookup is temporarily unavailable.',
        );
      }
      if (resolution.status !== 'resolved') return success(resolution);

      let candidates;
      try {
        candidates = (await catalog.list('verified_catalog')).filter(
          (item) =>
            item.kind === 'food' && item.verificationStatus === 'verified',
        );
      } catch {
        return failure(
          'dependency_failure',
          'Nearby recommendations are temporarily unavailable.',
        );
      }

      let matrixRoutes: readonly WalkingRouteEvidence[] | undefined;
      if (routeProvider.walkingMany) {
        try {
          matrixRoutes = await routeProvider.walkingMany(
            resolution.location.point,
            candidates.map((item) => ({
              latitude: item.latitude,
              longitude: item.longitude,
            })),
          );
        } catch {
          matrixRoutes = candidates.map(() => ({
            status: 'unavailable' as const,
            warning: 'Walking route is temporarily unavailable.',
          }));
        }
      }
      const evaluated = await Promise.all(
        candidates.map(async (item, index) => {
          const straightLineDistanceKm = distanceInKm(
            resolution.location.point,
            {
              latitude: item.latitude,
              longitude: item.longitude,
            },
          );
          try {
            const evidence = matrixRoutes
              ? (matrixRoutes[index] ?? {
                  status: 'unavailable' as const,
                  warning: 'Walking route is unavailable.',
                })
              : await routeProvider.walking(resolution.location.point, {
                  latitude: item.latitude,
                  longitude: item.longitude,
                });
            const route = normalizeWalkingRoute(
              evidence,
              clock.now(),
              routeEvidenceMaximumAgeMs,
            );
            return { item, straightLineDistanceKm, route };
          } catch {
            return {
              item,
              straightLineDistanceKm,
              route: {
                status: 'unavailable',
                warning: 'Walking route is temporarily unavailable.',
              } as const,
            };
          }
        }),
      );

      const recommendations = evaluated
        .flatMap(({ item, straightLineDistanceKm, route }) =>
          route.status === 'fresh' &&
          route.durationSeconds <= maximumWalkingDurationSeconds
            ? [
                {
                  itemId: item.id,
                  name: item.title,
                  area: item.area,
                  address: item.address,
                  straightLineDistanceKm,
                  visited: item.hasVisited === true,
                  route,
                },
              ]
            : [],
        )
        .sort(compareRecommendations)
        .slice(0, maximumRecommendations);
      const unavailableRoutes = evaluated.flatMap(
        ({ item, straightLineDistanceKm, route }) =>
          route.status !== 'fresh'
            ? [
                {
                  itemId: item.id,
                  name: item.title,
                  straightLineDistanceKm,
                  warning: route.warning,
                },
              ]
            : [],
      );

      return success({
        status: 'resolved',
        requestedLocation: locationHint,
        resolvedLocation: resolution.location.canonicalAddress,
        recommendations,
        unavailableRoutes,
        distanceCandidates:
          recommendations.length === 0
            ? buildDistanceCandidates(evaluated)
            : [],
        directTransitCandidates:
          recommendations.length === 0
            ? await buildDirectTransitCandidates(
                evaluated,
                resolution.location.point,
                freshnessCheckedTransitProvider(
                  transitRouteProvider,
                  clock,
                  routeEvidenceMaximumAgeMs,
                ),
              )
            : [],
        attribution: resolution.attribution,
        provenance: resolution.provenance,
      });
    },
  };
}

function compareRecommendations(
  left: WalkingRecommendation,
  right: WalkingRecommendation,
): number {
  if (left.visited !== right.visited) return left.visited ? 1 : -1;
  if (left.route.durationSeconds !== right.route.durationSeconds) {
    return left.route.durationSeconds - right.route.durationSeconds;
  }
  return left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0;
}

function normalizeWalkingRoute(
  route: WalkingRouteEvidence,
  now: Date,
  maximumAgeMs: number,
): WalkingRouteEvidence {
  if (route.status !== 'fresh') return route;
  return isCurrentRequestEvidence(route.checkedAt, now, maximumAgeMs)
    ? route
    : {
        status: 'stale',
        checkedAt: route.checkedAt,
        attribution: route.attribution,
        warning: 'Walking route evidence is stale or invalid.',
      };
}

function freshnessCheckedTransitProvider(
  provider: TransitRouteProvider | undefined,
  clock: { readonly now: () => Date },
  maximumAgeMs: number,
): TransitRouteProvider | undefined {
  if (!provider) return undefined;
  return {
    async transit(origin, destination) {
      const route = await provider.transit(origin, destination);
      return normalizeTransitRoute(route, clock.now(), maximumAgeMs);
    },
  };
}

function normalizeTransitRoute(
  route: TransitRouteEvidence,
  now: Date,
  maximumAgeMs: number,
): TransitRouteEvidence {
  if (route.status !== 'fresh') return route;
  return isCurrentRequestEvidence(route.checkedAt, now, maximumAgeMs)
    ? route
    : {
        status: 'stale',
        checkedAt: route.checkedAt,
        attribution: route.attribution,
        warning: 'Transit route evidence is stale or invalid.',
      };
}

function isCurrentRequestEvidence(
  checkedAt: string,
  now: Date,
  maximumAgeMs: number,
): boolean {
  const checkedAtMs = Date.parse(checkedAt);
  const ageMs = now.getTime() - checkedAtMs;
  return (
    Number.isFinite(checkedAtMs) &&
    Number.isFinite(now.getTime()) &&
    ageMs >= 0 &&
    ageMs <= maximumAgeMs
  );
}
