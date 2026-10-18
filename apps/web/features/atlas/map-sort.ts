import type { AtlasItem } from './model';

export type MapSort = 'added' | 'score';

export function sortMapItems(
  items: readonly AtlasItem[],
  distances: Readonly<Record<string, number>> = {},
  sort: MapSort = 'added',
): AtlasItem[] {
  return [...items].sort((left, right) => {
    const leftDistance = distances[left.id];
    const rightDistance = distances[right.id];
    // Nearby searches explicitly order located places by distance.
    if (leftDistance !== undefined || rightDistance !== undefined) {
      if (leftDistance === undefined) return 1;
      if (rightDistance === undefined) return -1;
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    }

    if (sort === 'added') return 0;

    const leftScore = left.hasVisited ? left.personalRating : undefined;
    const rightScore = right.hasVisited ? right.personalRating : undefined;
    if (leftScore === undefined && rightScore !== undefined) return 1;
    if (rightScore === undefined && leftScore !== undefined) return -1;
    if (
      leftScore !== undefined &&
      rightScore !== undefined &&
      leftScore !== rightScore
    ) {
      return rightScore - leftScore;
    }

    const leftTabelog = left.tabelog?.score;
    const rightTabelog = right.tabelog?.score;
    if (leftTabelog === undefined && rightTabelog !== undefined) return 1;
    if (rightTabelog === undefined && leftTabelog !== undefined) return -1;
    return (rightTabelog ?? 0) - (leftTabelog ?? 0);
  });
}
