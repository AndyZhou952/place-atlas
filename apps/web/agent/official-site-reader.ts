import type { SearchEvidence } from './web-search.ts';
import { readBoundedText } from './web-search.ts';

/** Read at most four pages on one public HTTPS origin, without credentials or redirects. */
export async function readOfficialSite(
  websiteUri: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SearchEvidence[]> {
  const root = publicPage(websiteUri);
  if (!root) return [];
  const first = await readPage(root, signal, fetcher);
  if (!first) return [];
  const links = [...first.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)]
    .map((match) => {
      const href = /\bhref\s*=\s*(["'])(.*?)\1/iu.exec(match[1])?.[2];
      if (!href) return undefined;
      const page = publicPage(decodeEntities(href), root);
      if (!page || page.origin !== root.origin || page.href === root.href)
        return undefined;
      const label = plainText(match[2]);
      const rank = /restaurant|店舗|料理/iu.test(`${page.pathname} ${label}`)
        ? 0
        : /contact|location|find.us|access|アクセス/iu.test(
              `${page.pathname} ${label}`,
            )
          ? 1
          : /reserv|book|予約/iu.test(`${page.pathname} ${label}`)
            ? 2
            : 3;
      return rank < 3 ? { page, rank } : undefined;
    })
    .filter((value): value is { page: URL; rank: number } => Boolean(value))
    .sort((left, right) => left.rank - right.rank);
  const selected = [
    ...new Map(
      links.map(({ page, rank }) => [page.href, { page, rank }]),
    ).values(),
  ].slice(0, 3);
  const followUps = await Promise.all(
    selected.map(({ page }) => readPage(page, signal, fetcher)),
  );
  return [
    first,
    ...followUps.filter((page): page is ReadPage => Boolean(page)),
  ].map((page) => ({
    url: page.url,
    title: page.title,
    content: page.content,
  }));
}

interface ReadPage {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly html: string;
}

async function readPage(
  page: URL,
  parentSignal: AbortSignal,
  fetcher: typeof fetch,
): Promise<ReadPage | undefined> {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(8_000)]);
  try {
    const response = await fetcher(page.href, {
      redirect: 'manual',
      signal,
      headers: { Accept: 'text/html' },
    });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('text/html')
    ) {
      await response.body?.cancel();
      return undefined;
    }
    const html = await readBoundedText(response, 262_144);
    const title = plainText(
      /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html)?.[1] ?? '',
    ).slice(0, 300);
    const content = plainText(
      html
        .replace(
          /<(?:script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|svg|noscript)\s*>/giu,
          ' ',
        )
        .replace(
          /<(?:nav|footer)\b[^>]*>[\s\S]*?<\/(?:nav|footer)\s*>/giu,
          ' ',
        ),
    ).slice(0, 8_000);
    const bookingLinks = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)]
      .flatMap((match) => {
        const label = plainText(match[2]).slice(0, 80);
        const href = /\bhref\s*=\s*(["'])(.*?)\1/iu.exec(match[1])?.[2];
        const destination = href
          ? publicPage(decodeEntities(href), page)
          : undefined;
        return destination &&
          /\b(?:reservations?|reserve now|book a table|book now|booking)\b|予約/iu.test(
            label,
          )
          ? [`${label}: ${destination.href}`]
          : [];
      })
      .slice(0, 5);
    return content.length >= 20
      ? {
          url: page.href,
          title,
          content: `${content} ${bookingLinks.join(' ')} Page URL: ${page.href}`,
          html,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function publicPage(value: string, base?: URL): URL | undefined {
  try {
    const url = new URL(value, base);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?!\d)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/iu.test(url.hostname)
    )
      return undefined;
    url.hash = '';
    url.search = '';
    return url;
  } catch {
    return undefined;
  }
}

function plainText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/giu,
    (whole, entity: string) => {
      const named: Record<string, string> = {
        amp: '&',
        quot: '"',
        apos: "'",
        lt: '<',
        gt: '>',
        nbsp: ' ',
      };
      const lower = entity.toLowerCase();
      if (named[lower]) return named[lower];
      const number = lower.startsWith('#x')
        ? Number.parseInt(lower.slice(2), 16)
        : lower.startsWith('#')
          ? Number.parseInt(lower.slice(1), 10)
          : NaN;
      return Number.isInteger(number) && number > 0 && number <= 0x10ffff
        ? String.fromCodePoint(number)
        : whole;
    },
  );
}
