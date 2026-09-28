import { explicitReservationTiming } from './reservation-timing.ts';
import { readBoundedText, type SearchEvidence } from './web-search.ts';

export interface TableCheckBookingEvidence extends SearchEvidence {
  readonly booking: {
    readonly name: string;
    readonly address: string;
    readonly bookingWindowLabel: string;
    readonly advanceDays?: number;
  };
}

export type TableCheckReadResult =
  | { readonly kind: 'read'; readonly evidence: TableCheckBookingEvidence }
  | { readonly kind: 'blocked' | 'unavailable' | 'invalid_source' };

/** A single public merchant booking page; no arbitrary URL, cookies or redirects. */
export function isTableCheckBookingPage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      ['tablecheck.com', 'www.tablecheck.com'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /^\/(?:[a-z]{2}\/)?[a-z0-9-]{3,120}\/reserve\/landing\/?$/u.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

export async function readTableCheckBookingPage(
  url: string,
  fetcher: typeof fetch,
  parentSignal: AbortSignal,
): Promise<TableCheckReadResult> {
  if (!isTableCheckBookingPage(url)) return { kind: 'invalid_source' };
  try {
    const response = await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.any([parentSignal, AbortSignal.timeout(6000)]),
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
    const html = await readBoundedText(response, 1_048_576);
    if (/cf-chl-|cf_chl_|<title[^>]*>\s*Just a moment/iu.test(html))
      return { kind: 'blocked' };
    const evidence = parseTableCheckBookingPage(html, url);
    return evidence ? { kind: 'read', evidence } : { kind: 'invalid_source' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Keep only branch identity and the explicit window, not the full HTML page. */
export function parseTableCheckBookingPage(
  html: string,
  sourceUrl: string,
): TableCheckBookingEvidence | undefined {
  if (!isTableCheckBookingPage(sourceUrl)) return undefined;
  const title = /<title\b[^>]*>([\s\S]{1,300}?)<\/title>/iu.exec(html)?.[1];
  if (!title || !/\s[-–]\sTableCheck\s*$/iu.test(decode(title).trim()))
    return undefined;
  const name = decode(title)
    .replace(/\s[-–]\sTableCheck\s*$/iu, '')
    .trim();
  const text = decode(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, ' ')
      .replace(/<[^>]*>/gu, ' '),
  ).replace(/\s+/gu, ' ');
  const timing = explicitReservationTiming(text);
  if (!timing.bookingWindowLabel) return undefined;
  const timingIndex = html.indexOf(timing.bookingWindowLabel);
  const addressIndex = Math.max(
    html.lastIndexOf('【Address】', timingIndex),
    html.lastIndexOf('【住所】', timingIndex),
  );
  if (
    timingIndex < 0 ||
    addressIndex < 0 ||
    timingIndex - addressIndex > 2000 ||
    name.length < 3
  )
    return undefined;
  const address =
    /【(?:Address|住所)】(?:<[^>]*>|\s){0,6}([^<]{8,220})<br\b/iu.exec(
      html.slice(addressIndex, timingIndex),
    )?.[1];
  if (!address) return undefined;
  const cleanAddress = decode(address).replace(/\s+/gu, ' ').trim();
  const content = `${name} ${cleanAddress}\n${timing.bookingWindowLabel}`;
  return {
    url: sourceUrl,
    title: name,
    content,
    booking: {
      name,
      address: cleanAddress,
      bookingWindowLabel: timing.bookingWindowLabel,
      ...(timing.advanceDays === undefined
        ? {}
        : { advanceDays: timing.advanceDays }),
    },
  };
}

function decode(value: string): string {
  return value.replace(
    /&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|nbsp);/giu,
    (raw, entity: string) => {
      const named: Record<string, string> = {
        amp: '&',
        quot: '"',
        apos: "'",
        nbsp: ' ',
      };
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? raw;
      const codePoint =
        entity[1]?.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(codePoint) &&
        codePoint > 0 &&
        codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : raw;
    },
  );
}
