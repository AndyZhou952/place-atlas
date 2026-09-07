import type { VisitRecord } from './model';

export interface JournalFilter {
  readonly placeId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

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
