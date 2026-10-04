import type { VisitRecord } from './model';

export interface JournalFilter {
  readonly placeId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export type JournalSort =
  | 'visited-desc'
  | 'visited-asc'
  | 'recorded-desc'
  | 'recorded-asc';

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
): VisitRecord[] {
  return [...visits].sort((left, right) => {
    const dateField = sort.startsWith('visited-') ? 'visitedAt' : 'createdAt';
    const direction = sort.endsWith('-desc') ? -1 : 1;
    return (
      direction * left[dateField].localeCompare(right[dateField]) ||
      direction * left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );
  });
}
