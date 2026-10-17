import type { AtlasItem, VisitRecord } from './model';

export interface JournalFilter {
  readonly placeId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export type JournalSort =
  | 'visited-desc'
  | 'visited-asc'
  | 'recorded-desc'
  | 'recorded-asc'
  | 'score-desc'
  | 'score-asc';

export function filterJournalVisits(
  visits: readonly VisitRecord[],
  filter: JournalFilter,
): VisitRecord[] {
  return visits.filter(
    (visit) =>
      (filter.placeId === 'all' || visit.itemId === filter.placeId) &&
      (!filter.fromDate || visit.visitedAt >= filter.fromDate) &&
      (!filter.toDate || visit.visitedAt <= filter.toDate),
  );
}

export function sortJournalVisits(
  visits: readonly VisitRecord[],
  sort: JournalSort,
  itemsById: ReadonlyMap<string, Pick<AtlasItem, 'personalRating'>> = new Map(),
): VisitRecord[] {
  return [...visits].sort((left, right) => {
    if (sort.startsWith('score-')) {
      const leftScore = itemsById.get(left.itemId)?.personalRating;
      const rightScore = itemsById.get(right.itemId)?.personalRating;
      if (leftScore === undefined && rightScore !== undefined) return 1;
      if (rightScore === undefined && leftScore !== undefined) return -1;
      const direction = sort === 'score-desc' ? -1 : 1;
      return (
        direction * ((leftScore ?? 0) - (rightScore ?? 0)) ||
        right.visitedAt.localeCompare(left.visitedAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
      );
    }
    const dateField = sort.startsWith('visited-') ? 'visitedAt' : 'createdAt';
    const direction = sort.endsWith('-desc') ? -1 : 1;
    return (
      direction * left[dateField].localeCompare(right[dateField]) ||
      direction * left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  });
}
