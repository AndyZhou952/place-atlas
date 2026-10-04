import type { AtlasItem, SourceLink } from './model';

// Policy citations remain in stored evidence; these links are destinations.
export function restaurantLinks(item: AtlasItem): readonly SourceLink[] {
  if (item.kind !== 'food') return uniqueLinks(item.sources);
  const tabelog =
    item.tabelog?.url ??
    item.sources.find((source) => source.role === 'tabelog')?.url ??
    (isTabelog(item.officialUrl) ? item.officialUrl : undefined);
  const official =
    item.officialUrl ??
    item.sources.find((source) => source.role === 'official')?.url;
  const booking = item.reservation.url;
  return uniqueLinks([
    ...(tabelog
      ? [{ role: 'tabelog' as const, label: 'Tabelog', url: tabelog }]
      : []),
    ...(official && !isTabelog(official)
      ? [
          {
            role: 'official' as const,
            label: 'Official website',
            url: official,
          },
        ]
      : []),
    ...(booking && !isTabelog(booking)
      ? [{ role: 'reservation' as const, label: 'Booking', url: booking }]
      : []),
  ]);
}

function isTabelog(value?: string): boolean {
  try {
    const host = new URL(value ?? '').hostname;
    return host === 'tabelog.com' || host.endsWith('.tabelog.com');
  } catch {
    return false;
  }
}

function uniqueLinks(links: readonly SourceLink[]): readonly SourceLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    try {
      const url = new URL(link.url);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return false;
      const fragment = /^#(?:\/|!)/u.test(url.hash) ? url.hash : '';
      const key = `${url.origin}${url.pathname.replace(/\/$/u, '')}${url.search}${fragment}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });
}
