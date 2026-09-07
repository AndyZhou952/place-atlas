import type { AtlasItem, AtlasPersonalFilter } from './model';

type PersonalStatus = Pick<AtlasItem, 'hasVisited' | 'isFavorite'>;

export function matchesPersonalStatus(
  item: PersonalStatus,
  visitFilter: AtlasPersonalFilter,
  favoriteOnly: boolean,
): boolean {
  const matchesVisit =
    visitFilter === 'all' ||
    (visitFilter === 'unvisited' && !item.hasVisited) ||
    (visitFilter === 'visited' && Boolean(item.hasVisited));

  return matchesVisit && (!favoriteOnly || Boolean(item.isFavorite));
}
