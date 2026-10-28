import { matchesQuery } from '../../shared/text.ts';
import type { GoogleRating, Restaurant, Visit } from '../../shared/types.ts';

// Pure view logic shared by view-models; unit-tested without React.

export type VisitFilter = 'all' | 'unvisited' | 'visited';
export type MapSort = 'added' | 'score';

/** Unknown values always sort last, whatever the direction. */
function compareOptional<T extends number | string>(
  a: T | undefined,
  b: T | undefined,
  ascending: boolean,
): number {
  if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1;
  const order =
    typeof a === 'number' ? a - (b as number) : String(a).localeCompare(String(b), 'ja');
  return ascending ? order : -order;
}

export function mapItems(
  restaurants: readonly Restaurant[],
  filter: { query: string; visit: VisitFilter; favoritesOnly: boolean; sort: MapSort },
): Restaurant[] {
  const visible = restaurants.filter(
    (r) =>
      matchesQuery([r.title, r.alternateTitle], filter.query) &&
      (filter.visit === 'all' || r.visited === (filter.visit === 'visited')) &&
      (!filter.favoritesOnly || r.favorite),
  );
  if (filter.sort === 'added') return visible;
  return [...visible].sort(
    (a, b) =>
      compareOptional(a.visited ? a.rating : undefined, b.visited ? b.rating : undefined, false) ||
      compareOptional(a.tabelog?.score, b.tabelog?.score, false),
  );
}

export type TableSort = 'lastVisit' | 'rating' | 'tabelog' | 'google' | 'name';
export interface TableFilter {
  readonly query: string;
  readonly cuisine: string;
  readonly prefecture: string;
  readonly sort: TableSort;
  readonly ascending: boolean;
}
export const emptyTableFilter: TableFilter = {
  query: '',
  cuisine: 'all',
  prefecture: 'all',
  sort: 'lastVisit',
  ascending: false,
};

export interface TableRow {
  readonly restaurant: Restaurant;
  readonly visits: readonly Visit[];
  readonly lastVisit?: string;
}

export function tableRows(
  restaurants: readonly Restaurant[],
  visits: readonly Visit[],
  google: Readonly<Record<string, GoogleRating>>,
  filter: TableFilter,
): TableRow[] {
  const byRestaurant = Map.groupBy(visits, (visit) => visit.restaurantId);
  const matchesCode = (selected: string, values: readonly string[]) =>
    selected === 'all' ||
    (selected === 'unknown' ? values.length === 0 : values.includes(selected));
  const value = (row: TableRow) =>
    ({
      lastVisit: row.lastVisit,
      rating: row.restaurant.rating,
      tabelog: row.restaurant.tabelog?.score,
      google: google[row.restaurant.id]?.score,
      name: row.restaurant.title,
    })[filter.sort];
  return restaurants
    .filter(
      (r) =>
        matchesQuery([r.title, r.alternateTitle, r.address, r.area], filter.query) &&
        matchesCode(filter.cuisine, r.cuisines) &&
        matchesCode(filter.prefecture, r.prefecture ? [r.prefecture] : []),
    )
    .map((restaurant) => {
      const own = sortVisits(byRestaurant.get(restaurant.id) ?? [], 'visited-desc');
      return { restaurant, visits: own, lastVisit: own[0]?.visitedOn };
    })
    .sort(
      (a, b) =>
        compareOptional(value(a), value(b), filter.ascending) ||
        a.restaurant.title.localeCompare(b.restaurant.title, 'ja'),
    );
}

export type JournalSort =
  | 'visited-desc'
  | 'visited-asc'
  | 'recorded-desc'
  | 'recorded-asc'
  | 'score-desc'
  | 'score-asc';

export function sortVisits(
  visits: readonly Visit[],
  sort: JournalSort,
  ratings: ReadonlyMap<string, number | undefined> = new Map(),
): Visit[] {
  const ascending = sort.endsWith('-asc');
  const key = (visit: Visit) =>
    sort.startsWith('score')
      ? ratings.get(visit.restaurantId)
      : sort.startsWith('visited')
        ? visit.visitedOn
        : visit.createdAt;
  return [...visits].sort(
    (a, b) =>
      compareOptional(key(a), key(b), ascending) ||
      compareOptional(a.visitedOn, b.visitedOn, false) ||
      compareOptional(a.createdAt, b.createdAt, false),
  );
}

export function journalEntries(
  visits: readonly Visit[],
  restaurants: readonly Restaurant[],
  filter: { restaurantId: string; from: string; to: string; sort: JournalSort },
) {
  const byId = new Map(restaurants.map((r) => [r.id, r]));
  // "Visit n of m" counts every visit to the restaurant in date order.
  const numbers = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const visit of sortVisits(visits, 'visited-asc')) {
    const n = (totals.get(visit.restaurantId) ?? 0) + 1;
    totals.set(visit.restaurantId, n);
    numbers.set(visit.id, n);
  }
  const ratings = new Map(restaurants.map((r) => [r.id, r.rating]));
  return sortVisits(visits, filter.sort, ratings).flatMap((visit) => {
    const restaurant = byId.get(visit.restaurantId);
    const included =
      restaurant &&
      (filter.restaurantId === 'all' || visit.restaurantId === filter.restaurantId) &&
      (!filter.from || visit.visitedOn >= filter.from) &&
      (!filter.to || visit.visitedOn <= filter.to);
    return included
      ? [
          {
            visit,
            restaurant,
            number: numbers.get(visit.id) ?? 1,
            total: totals.get(visit.restaurantId) ?? 1,
          },
        ]
      : [];
  });
}

/** Destination links only: one Tabelog listing, then distinct official, booking and Maps links. */
export function restaurantLinks(restaurant: Restaurant): { label: string; url: string }[] {
  const links = [
    restaurant.tabelog && { label: 'Tabelog', url: restaurant.tabelog.url },
    restaurant.officialUrl && { label: 'Official website', url: restaurant.officialUrl },
    restaurant.reservation.bookingUrl && {
      label: 'Booking',
      url: restaurant.reservation.bookingUrl,
    },
    restaurant.googlePlaceId && {
      label: 'Google Maps',
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.title)}&query_place_id=${restaurant.googlePlaceId}`,
    },
  ].filter((link): link is { label: string; url: string } => Boolean(link));
  const seen = new Set<string>();
  return links.filter(
    ({ url }) => !seen.has(url.replace(/\/$/u, '')) && Boolean(seen.add(url.replace(/\/$/u, ''))),
  );
}

export function searchRestaurants(restaurants: readonly Restaurant[], query: string): Restaurant[] {
  return restaurants.filter((r) => matchesQuery([r.title, r.alternateTitle], query));
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
