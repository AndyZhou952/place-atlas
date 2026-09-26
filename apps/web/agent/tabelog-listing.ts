import { isTabelogRestaurantListing } from './research-instructions.ts';
import { readBoundedText, type SearchEvidence } from './web-search.ts';

export interface TabelogEvidence extends SearchEvidence {
  restaurant?: {
    name: string;
    address: string;
    area: string;
    score: number;
    coordinates?: { latitude: number; longitude: number };
    categories: string[];
    reservation?: string;
    officialWebsite?: string;
    introduction?: string;
  };
}

/** Only a discovered main listing on a fixed public host, never arbitrary model URLs. */
export async function readTabelogListing(
  url: string,
  fetcher: typeof fetch,
  parentSignal: AbortSignal,
): Promise<TabelogEvidence | undefined> {
  const result = await readTabelogListingResult(url, fetcher, parentSignal);
  return result.kind === 'read' ? result.evidence : undefined;
}

export type TabelogReadResult =
  | { kind: 'read'; evidence: TabelogEvidence }
  | { kind: 'blocked' | 'unavailable' | 'invalid_source' };

/** Keep access failures distinct from a successfully read page with missing facts. */
export async function readTabelogListingResult(
  url: string,
  fetcher: typeof fetch,
  parentSignal: AbortSignal,
): Promise<TabelogReadResult> {
  if (!isTabelogRestaurantListing(url)) return { kind: 'invalid_source' };
  const target = new URL(url);
  target.search = '';
  target.hash = '';
  try {
    const response = await fetcher(target.href, {
      redirect: 'manual',
      signal: AbortSignal.any([parentSignal, AbortSignal.timeout(5000)]),
      headers: { Accept: 'text/html', 'User-Agent': 'JapanAtlas/1.0' },
    });
    if ([401, 403, 429].includes(response.status)) {
      await response.body?.cancel();
      return { kind: 'blocked' };
    }
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('text/html')
    ) {
      await response.body?.cancel();
      return { kind: 'unavailable' };
    }
    const evidence = parseTabelogListing(
      await readBoundedText(response, 1_048_576),
      url,
    );
    return evidence ? { kind: 'read', evidence } : { kind: 'invalid_source' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Discard reviews entirely; only Restaurant.aggregateRating can supply a score. */
export function parseTabelogListing(
  html: string,
  sourceUrl: string,
): TabelogEvidence | undefined {
  if (!isTabelogRestaurantListing(sourceUrl)) return undefined;
  const identity = (value: string) =>
    new URL(value).pathname.replace(/\/$/u, '');
  const records: Record<string, unknown>[] = [];
  for (const script of html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/giu,
  )) {
    try {
      const parsed = JSON.parse(script[1]);
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      for (const root of roots) {
        if (!root || typeof root !== 'object') continue;
        records.push(root);
        if (Array.isArray(root['@graph'])) records.push(...root['@graph']);
      }
    } catch {
      /* An invalid block supplies no evidence. */
    }
  }
  const matches = records.filter((record) => {
    if (!record || record['@type'] !== 'Restaurant') return false;
    const id = record['@id'] ?? record.url;
    return (
      typeof id === 'string' &&
      isTabelogRestaurantListing(id) &&
      identity(id) === identity(sourceUrl)
    );
  });
  // Multiple records for the same identity require adjudication, not an arbitrary choice.
  if (matches.length !== 1) return undefined;
  const record = matches[0];
  const address = record.address as Record<string, unknown> | undefined;
  const rating = record.aggregateRating as Record<string, unknown> | undefined;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const parts = ['addressRegion', 'addressLocality', 'streetAddress'].map(
    (key) => address?.[key],
  );
  if (
    !name ||
    name.length > 300 ||
    parts.some(
      (part) => typeof part !== 'string' || !part.trim() || part.length > 500,
    )
  )
    return undefined;
  if (rating?.['@type'] !== 'AggregateRating') return undefined;
  const rawScore = rating.ratingValue;
  if (
    !['number', 'string'].includes(typeof rawScore) ||
    !/^\d(?:\.\d{1,2})?$/u.test(String(rawScore))
  )
    return undefined;
  const score = Number(rawScore);
  if (score < 1 || score > 5) return undefined;
  const clean = (text: string) =>
    text
      .replace(/<[^>]*>/gu, ' ')
      .replace(/&nbsp;|&#160;/gu, ' ')
      .replace(/&amp;/gu, '&')
      .replace(/&quot;/gu, '"')
      .replace(/&#39;/gu, "'")
      .replace(/\s+/gu, ' ')
      .trim();
  const row = (label: string) =>
    new RegExp(
      `<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`,
      'iu',
    ).exec(html)?.[1];
  const reservation = clean(row('予約可否') ?? '').slice(0, 1000);
  const introduction = clean(row('お店のPR') ?? '')
    .replace(/続きを読む/gu, '')
    .slice(0, 1200);
  const officialRow = row('ホームページ');
  const website =
    officialRow && /href=["'](https:\/\/[^"']+)["']/iu.exec(officialRow)?.[1];
  const categories = (
    typeof record.servesCuisine === 'string'
      ? record.servesCuisine.split(/[、,]/u)
      : []
  )
    .map(clean)
    .filter(Boolean)
    .slice(0, 8);
  const geo = record.geo as Record<string, unknown> | undefined;
  const coordinates =
    typeof geo?.latitude === 'number' &&
    typeof geo.longitude === 'number' &&
    Number.isFinite(geo.latitude) &&
    Number.isFinite(geo.longitude) &&
    Math.abs(geo.latitude) <= 90 &&
    Math.abs(geo.longitude) <= 180
      ? { latitude: geo.latitude, longitude: geo.longitude }
      : undefined;
  const restaurant: NonNullable<TabelogEvidence['restaurant']> = {
    name,
    address: parts.join(''),
    score,
    categories,
    area: `${String(parts[1])}${String(parts[2]).split(/[0-9０-９]/u)[0]}`.trim(),
    ...(coordinates ? { coordinates } : {}),
    ...(reservation ? { reservation } : {}),
    ...(introduction ? { introduction } : {}),
    ...(website ? { officialWebsite: clean(website) } : {}),
  };
  return {
    url: sourceUrl,
    title: name,
    content: `${name} ${parts.join('')}\nTabelog aggregate restaurant rating: ${score.toFixed(2)}\nRestaurant facts: ${JSON.stringify(restaurant)}`,
    restaurant,
  };
}
