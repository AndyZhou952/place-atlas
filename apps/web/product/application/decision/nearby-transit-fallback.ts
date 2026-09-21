import type { AtlasItem } from '../catalog/atlas-item.ts';
import type {
  DirectTransitCandidate,
  GeoPoint,
  TransitRouteProvider,
} from './nearby-recommendation.ts';

const maximumDoorToDoorDurationSeconds = 20 * 60;
const maximumCandidates = 5;

export async function buildDirectTransitCandidates(
  evaluated: readonly {
    readonly item: AtlasItem;
    readonly straightLineDistanceKm: number;
  }[],
  origin: GeoPoint,
  transitRouteProvider: TransitRouteProvider | undefined,
): Promise<readonly DirectTransitCandidate[]> {
  if (!transitRouteProvider) return [];

  const routed = await Promise.all(
    evaluated.map(async ({ item, straightLineDistanceKm }) => {
      try {
        const route = await transitRouteProvider.transit(origin, {
          latitude: item.latitude,
          longitude: item.longitude,
        });
        return { item, straightLineDistanceKm, route };
      } catch {
        return undefined;
      }
    }),
  );

  return routed
    .flatMap((candidate) => {
      if (!candidate || !isDirect(candidate.route)) return [];
      return [
        {
          itemId: candidate.item.id,
          name: candidate.item.title,
          area: candidate.item.area,
          address: candidate.item.address,
          straightLineDistanceKm: candidate.straightLineDistanceKm,
          visited: candidate.item.hasVisited === true,
          route: candidate.route,
        },
      ];
    })
    .sort((left, right) => {
      if (left.visited !== right.visited) return left.visited ? 1 : -1;
      if (left.route.durationSeconds !== right.route.durationSeconds) {
        return left.route.durationSeconds - right.route.durationSeconds;
      }
      return left.itemId < right.itemId
        ? -1
        : left.itemId > right.itemId
          ? 1
          : 0;
    })
    .slice(0, maximumCandidates);
}

function isDirect(
  route: Awaited<ReturnType<TransitRouteProvider['transit']>>,
): route is Extract<typeof route, { readonly status: 'fresh' }> {
  return (
    route.status === 'fresh' &&
    route.durationSeconds <= maximumDoorToDoorDurationSeconds &&
    route.boardingCount === 1 &&
    route.transferCount === 0 &&
    route.lineIdentities.length === 1 &&
    route.lineIdentities[0].trim().length > 0
  );
}
