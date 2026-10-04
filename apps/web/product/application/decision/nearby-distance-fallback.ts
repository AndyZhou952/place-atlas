import type { AtlasItem } from '../catalog/atlas-item.ts';
import type { DistanceCandidate } from './nearby-recommendation.ts';

const maximumDistanceKm = 2;
const maximumCandidates = 5;

export function buildDistanceCandidates(
  evaluated: readonly {
    readonly item: AtlasItem;
    readonly straightLineDistanceKm: number;
  }[],
): readonly DistanceCandidate[] {
  return evaluated
    .filter(
      ({ straightLineDistanceKm }) =>
        straightLineDistanceKm <= maximumDistanceKm,
    )
    .map(({ item, straightLineDistanceKm }) => ({
      itemId: item.id,
      name: item.title,
      area: item.area,
      address: item.address,
      straightLineDistanceKm,
      visited: item.hasVisited === true,
      warning: 'Straight-line distance only; travel time is not verified.',
    }))
    .sort((left, right) => {
      if (left.visited !== right.visited) return left.visited ? 1 : -1;
      if (left.straightLineDistanceKm !== right.straightLineDistanceKm) {
        return left.straightLineDistanceKm - right.straightLineDistanceKm;
      }
      return left.itemId < right.itemId
        ? -1
        : left.itemId > right.itemId
          ? 1
          : 0;
    })
    .slice(0, maximumCandidates);
}
