/** Width-, case- and punctuation-insensitive form used for search and matching. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

/** Every whitespace-separated token must appear in one of the fields. */
export function matchesQuery(fields: readonly (string | undefined)[], query: string): boolean {
  const haystack = fields.map((field) => normalizeText(field ?? ''));
  return query
    .split(/\s+/u)
    .map(normalizeText)
    .every((token) => !token || haystack.some((field) => field.includes(token)));
}

export function distanceKm(
  a: { readonly latitude: number; readonly longitude: number },
  b: { readonly latitude: number; readonly longitude: number },
): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 +
    Math.cos(a.latitude * rad) *
      Math.cos(b.latitude * rad) *
      Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

/** Personal ratings are 0–10 with one decimal place. */
export function normalizeRating(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    throw new RangeError('Rating must be a number from 0 to 10.');
  }
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

/** Main restaurant listing only; review, ranking and map pages are not listings. */
export function tabelogListingUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    const match = /^\/(?:(?:en|cn|tw|kr)\/)?([a-z]+\/A\d+\/A\d+\/\d{7,8})\/?$/u.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'tabelog.com' || url.port || !match) {
      return undefined;
    }
    return `https://tabelog.com/${match[1]}/`;
  } catch {
    return undefined;
  }
}
