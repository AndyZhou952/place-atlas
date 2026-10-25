import { useMemo, useState } from 'react';
import type { GoogleRating, Restaurant, Visit } from '../../shared/types.ts';
import {
  type JournalSort,
  type MapSort,
  type TableFilter,
  type VisitFilter,
  emptyTableFilter,
  journalEntries,
  mapItems,
  tableRows,
} from './selectors.ts';

export function useMapView(restaurants: readonly Restaurant[], selectedId?: string) {
  const [query, setQuery] = useState('');
  const [visit, setVisit] = useState<VisitFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<MapSort>('added');
  const items = useMemo(
    () => mapItems(restaurants, { query, visit, favoritesOnly, sort }),
    [restaurants, query, visit, favoritesOnly, sort],
  );
  // An explicitly opened restaurant stays selected even when filters would hide it.
  const selected = restaurants.find((r) => r.id === selectedId) ?? items[0];
  return {
    items,
    selected,
    query,
    setQuery,
    visit,
    setVisit,
    favoritesOnly,
    setFavoritesOnly,
    sort,
    setSort,
    summary: {
      saved: restaurants.length,
      visited: restaurants.filter((r) => r.visited).length,
      favorites: restaurants.filter((r) => r.favorite).length,
    },
  };
}

export function useTableView(
  restaurants: readonly Restaurant[],
  visits: readonly Visit[],
  google: Readonly<Record<string, GoogleRating>>,
) {
  const [filter, setFilter] = useState<TableFilter>(emptyTableFilter);
  const rows = useMemo(
    () => tableRows(restaurants, visits, google, filter),
    [restaurants, visits, google, filter],
  );
  return {
    rows,
    filter,
    update: (patch: Partial<TableFilter>) => setFilter((current) => ({ ...current, ...patch })),
    sortBy: (sort: TableFilter['sort']) =>
      setFilter((current) =>
        current.sort === sort
          ? { ...current, ascending: !current.ascending }
          : { ...current, sort, ascending: sort === 'name' },
      ),
    clear: () => setFilter(emptyTableFilter),
  };
}

export function useJournalView(visits: readonly Visit[], restaurants: readonly Restaurant[]) {
  const [filter, setFilter] = useState({
    restaurantId: 'all',
    from: '',
    to: '',
    sort: 'visited-desc' as JournalSort,
  });
  const entries = useMemo(
    () => journalEntries(visits, restaurants, filter),
    [visits, restaurants, filter],
  );
  const visitedRestaurants = useMemo(
    () => restaurants.filter((r) => visits.some((visit) => visit.restaurantId === r.id)),
    [restaurants, visits],
  );
  return {
    entries,
    filter,
    visitedRestaurants,
    update: (patch: Partial<typeof filter>) => setFilter((current) => ({ ...current, ...patch })),
    clear: () => setFilter((current) => ({ ...current, restaurantId: 'all', from: '', to: '' })),
  };
}
