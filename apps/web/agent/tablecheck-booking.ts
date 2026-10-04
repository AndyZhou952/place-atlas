import { explicitReservationTiming } from './reservation-timing.ts';
import { readBoundedText, type SearchEvidence } from './web-search.ts';

export interface TableCheckBookingEvidence extends SearchEvidence {
  readonly booking: {
    readonly name: string;
    readonly address?: string;
    readonly officialWebsiteHost?: string;
    readonly bookingWindowLabel?: string;
    readonly advanceDays?: number;
    readonly releaseNote?: string;
  };
}

export type TableCheckReadResult =
  | { readonly kind: 'read'; readonly evidence: TableCheckBookingEvidence }
  | { readonly kind: 'blocked' | 'unavailable' | 'invalid_source' };

/** Drop search-result tracking and category filters before opening a merchant page. */
export function canonicalTableCheckBookingUrl(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      ['tablecheck.com', 'www.tablecheck.com'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      (/^\/(?:[a-z]{2}\/)?[a-z0-9-]{3,120}\/reserve\/landing\/?$/u.test(
        url.pathname,
      ) ||
        /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shops\/[a-z0-9-]{3,120}\/reserve\/?$/iu.test(
          url.pathname,
        ))
    ) {
      url.search = '';
      url.hash = '';
      return url.href;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** A single public merchant booking page; no arbitrary URL, cookies or redirects. */
export function isTableCheckBookingPage(value: unknown): value is string {
  return (
    typeof value === 'string' && canonicalTableCheckBookingUrl(value) === value
  );
}

export async function readTableCheckBookingPage(
  url: string,
  fetcher: typeof fetch,
  parentSignal: AbortSignal,
): Promise<TableCheckReadResult> {
  if (!isTableCheckBookingPage(url)) return { kind: 'invalid_source' };
  try {
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(6000)]);
    const request = {
      redirect: 'manual',
      signal,
      headers: { Accept: 'text/html', 'User-Agent': 'JapanAtlas/1.0' },
    } as const;
    let target = url;
    let response = await fetcher(target, request);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      const next = location
        ? canonicalTableCheckBookingUrl(new URL(location, target).href)
        : undefined;
      const merchantPath = (value: string) =>
        new URL(value).pathname
          .replace(/^\/[a-z]{2}(?:-[a-z]{2})?\//iu, '/')
          .replace(/\/$/u, '');
      await response.body?.cancel();
      // One language redirect on the fixed provider, preserving the exact shop.
      // A second redirect, another shop, or another host supplies no evidence.
      if (
        !next ||
        next === target ||
        merchantPath(next) !== merchantPath(target)
      )
        return { kind: 'invalid_source' };
      target = next;
      response = await fetcher(target, request);
    }
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
    const evidence = parseTableCheckBookingPage(html, target);
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
  if (
    !title ||
    !/\s[-–]\sTableCheck(?:\s*\(テーブルチェック\))?\s*$/iu.test(
      decode(title).trim(),
    )
  )
    return undefined;
  const name = decode(title)
    .replace(/\s[-–]\sTableCheck(?:\s*\(テーブルチェック\))?\s*$/iu, '')
    .trim();
  const modern = /\/shops\//u.test(new URL(sourceUrl).pathname);
  if (modern) {
    const heading =
      /<h3\b[^>]*class=["'][^"']*panel-title[^"']*["'][^>]*>([^<]{3,200})を予約する<\/h3>/iu.exec(
        html,
      )?.[1];
    const policy =
      /<div\b[^>]*class=["'][^"']*reserveform-bookingpolicy-text[^"']*["'][^>]*>([\s\S]{1,12000}?)<\/div>/iu.exec(
        html,
      )?.[1];
    if (!heading || decode(heading).trim() !== name || !policy)
      return undefined;
    const policyText = decode(policy.replace(/<[^>]*>/gu, ' ')).replace(
      /\s+/gu,
      ' ',
    );
    const timing = explicitReservationTiming(policyText);
    // A working booking form need not publish a booking window. Keep the
    // branch address separately from policy so timing never gates the URL.
    const address =
      /class=["'][^"']*resreview-sidebar-content[^"']*["'][^>]*>\s*〒\d{3}-\d{4}\s*([^<]{8,220})<\/div>/iu.exec(
        html,
      )?.[1];
    const officialWebsiteHost = [
      ...policy.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu),
    ]
      .flatMap((match) => {
        const label = decode(match[2].replace(/<[^>]*>/gu, ' ')).trim();
        if (
          !/(?:official\s*(?:website|site)|公式(?:サイト|ホームページ|hp)|ホームページ)/iu.test(
            label,
          )
        )
          return [];
        const href = /\bhref\s*=\s*(["'])(https:\/\/[^"']+)\1/iu.exec(
          match[1],
        )?.[2];
        if (!href) return [];
        try {
          const url = new URL(decode(href));
          return url.username || url.password || url.port
            ? []
            : [url.hostname.replace(/^www\./u, '')];
        } catch {
          return [];
        }
      })
      .find(
        (host) => host !== 'tablecheck.com' && host !== 'www.tablecheck.com',
      );
    if (!officialWebsiteHost && !address) return undefined;
    return {
      url: sourceUrl,
      title: name,
      content: `${name} ${address ? decode(address).trim() : ''}\nBooking page: ${sourceUrl}\n${policyText.slice(0, 4000)}`,
      booking: {
        name,
        ...(address ? { address: decode(address).trim() } : {}),
        ...(officialWebsiteHost ? { officialWebsiteHost } : {}),
        ...timing,
      },
    };
  }
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
  const content = `${name} ${cleanAddress}\n${timing.bookingWindowLabel}${timing.releaseNote ? `\n${timing.releaseNote}` : ''}`;
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
      ...(timing.releaseNote ? { releaseNote: timing.releaseNote } : {}),
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
