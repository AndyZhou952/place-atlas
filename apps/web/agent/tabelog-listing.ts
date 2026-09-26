import { isTabelogRestaurantListing } from './research-instructions.ts';
import { readBoundedText, type SearchEvidence } from './web-search.ts';

/** Only a discovered main listing on a fixed public host, never arbitrary model URLs. */
export async function readTabelogListing(
  url: string,
  fetcher: typeof fetch,
  parentSignal: AbortSignal,
): Promise<SearchEvidence | undefined> {
  if (!isTabelogRestaurantListing(url)) return undefined;
  const target = new URL(url);
  target.search = '';
  target.hash = '';
  try {
    const response = await fetcher(target.href, {
      redirect: 'error',
      signal: AbortSignal.any([parentSignal, AbortSignal.timeout(5000)]),
      headers: { Accept: 'text/html', 'User-Agent': 'JapanAtlas/1.0' },
    });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('text/html')
    )
      return undefined;
    return parseTabelogListing(await readBoundedText(response, 1_048_576), url);
  } catch {
    return undefined;
  }
}

/** Discard reviews entirely; only Restaurant.aggregateRating can supply a score. */
export function parseTabelogListing(
  html: string,
  sourceUrl: string,
): SearchEvidence | undefined {
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
  return {
    url: sourceUrl,
    title: name,
    content: `${name} ${parts.join('')}\nTabelog aggregate restaurant rating: ${score.toFixed(2)}`,
  };
}
