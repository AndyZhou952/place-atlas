import type { AtlasItem, VisitRecord } from './model.ts';
import { matchesAtlasTextQuery } from '../../product/application/decision/search-policy.ts';

export type TableSort =
  | 'lastVisit'
  | 'personalRating'
  | 'tabelog'
  | 'google'
  | 'name';
export interface TableFilters {
  readonly query: string;
  readonly kind: string;
  readonly category: string;
  readonly country: string;
  readonly subdivision: string;
}
export interface CatalogTableRow {
  readonly item: AtlasItem;
  readonly visits: readonly VisitRecord[];
  readonly lastVisit?: string;
}

export function catalogTableRows(
  items: readonly AtlasItem[],
  visits: readonly VisitRecord[],
  filters: TableFilters,
  sort: TableSort,
  ascending: boolean,
): CatalogTableRow[] {
  const grouped = new Map<string, VisitRecord[]>();
  for (const visit of visits) {
    const list = grouped.get(visit.itemId) ?? [];
    list.push(visit);
    grouped.set(visit.itemId, list);
  }
  const rows = items
    .filter((item) => {
      const classification = item.classification;
      const cuisines = classification?.cuisines ?? [];
      const geography = classification?.geography;
      return (
        matchesAtlasTextQuery(
          [item.title, item.alternateTitle ?? '', item.address, item.area],
          filters.query,
        ) &&
        (filters.kind === 'all' || item.kind === filters.kind) &&
        (filters.category === 'all' ||
          (filters.category === 'unknown'
            ? item.kind === 'food' &&
              !cuisines.some((entry) => entry.categoryId)
            : cuisines.some(
                (entry) => entry.categoryId === filters.category,
              ))) &&
        (filters.country === 'all' ||
          (filters.country === 'unknown'
            ? !geography?.countryCode
            : geography?.countryCode === filters.country)) &&
        (filters.subdivision === 'all' ||
          (filters.subdivision === 'unknown'
            ? !geography?.subdivisionCode
            : geography?.subdivisionCode === filters.subdivision))
      );
    })
    .map((item) => {
      const itemVisits = [...(grouped.get(item.id) ?? [])].sort(
        (a, b) =>
          b.visitedAt.localeCompare(a.visitedAt) ||
          b.createdAt.localeCompare(a.createdAt) ||
          a.id.localeCompare(b.id),
      );
      return { item, visits: itemVisits, lastVisit: itemVisits[0]?.visitedAt };
    });
  const value = (row: CatalogTableRow) =>
    sort === 'lastVisit'
      ? row.lastVisit
      : sort === 'personalRating'
        ? row.item.personalRating
        : sort === 'tabelog'
          ? row.item.tabelog?.score
          : sort === 'google'
            ? row.item.googleRating?.score
            : row.item.title;
  return rows.sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === undefined && right !== undefined) return 1;
    if (right === undefined && left !== undefined) return -1;
    const comparison =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right, 'ja')
          : 0;
    return (
      (ascending ? comparison : -comparison) ||
      a.item.title.localeCompare(b.item.title, 'ja') ||
      a.item.id.localeCompare(b.item.id)
    );
  });
}

export const emptyTableFilters: TableFilters = {
  query: '',
  kind: 'all',
  category: 'all',
  country: 'all',
  subdivision: 'all',
};
