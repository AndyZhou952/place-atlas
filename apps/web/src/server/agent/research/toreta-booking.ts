import { readBoundedText } from './web-search.ts';
import type { TableCheckReadResult } from './tablecheck-booking.ts';

/** Preserve the client-side route needed by Toreta, on its fixed public host. */
export function canonicalToretaBookingUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'yoyaku.toreta.in' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      !/^\/[a-z0-9-]{3,120}\/?$/u.test(url.pathname) ||
      !['', '#/'].includes(url.hash)
    )
      return undefined;
    return `${url.origin}${url.pathname.replace(/\/$/u, '')}/#/`;
  } catch {
    return undefined;
  }
}

/** Only the merchant heading/address establish identity, never sister-shop notices. */
export function parseToretaBookingPage(html: string, url: string) {
  if (!canonicalToretaBookingUrl(url)) return undefined;
  if (!/<title[^>]*>[^<]+\|\s*かんたんネット予約【公式】<\/title>/u.test(html)) return undefined;
  const name = /<h3\b[^>]*class=["']name["'][^>]*>([^<]{2,200})<\/h3>/u.exec(html)?.[1]?.trim();
  const address = /<p\b[^>]*class=["']address["'][^>]*>([^<]{8,220})<\/p>/u.exec(html)?.[1]?.trim();
  if (!name || !address || !/ご予約にあたって|ウェブ予約システム/u.test(html)) return undefined;
  return {
    url: canonicalToretaBookingUrl(url)!,
    title: name,
    content: `${name} ${address}\nOfficial booking page: ${canonicalToretaBookingUrl(url)}`,
    booking: { name, address },
  };
}

export async function readToretaBookingPage(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<TableCheckReadResult> {
  const target = canonicalToretaBookingUrl(url);
  if (!target) return { kind: 'invalid_source' };
  try {
    const response = await fetcher(target.replace(/#\/$/u, ''), {
      redirect: 'manual',
      signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
      headers: { Accept: 'text/html' },
    });
    if ([401, 403, 429].includes(response.status)) {
      await response.body?.cancel();
      return { kind: 'blocked' };
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel();
      return { kind: 'unavailable' };
    }
    const evidence = parseToretaBookingPage(await readBoundedText(response, 1_048_576), target);
    return evidence ? { kind: 'read', evidence } : { kind: 'invalid_source' };
  } catch {
    return { kind: 'unavailable' };
  }
}
