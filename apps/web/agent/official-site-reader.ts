import type { SearchEvidence } from './web-search.ts';
import { readBoundedText } from './web-search.ts';

export interface OfficialSiteEvidence extends SearchEvidence {
  readonly bookingLinks: readonly { label: string; url: string }[];
  readonly operatingHours?: string;
  readonly branchLinks?: readonly {
    url: string;
    name: string;
    address: string;
  }[];
}

/** Read at most four pages on one public HTTPS origin, without credentials or redirects. */
export async function readOfficialSite(
  websiteUri: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  maximumPages = 4,
): Promise<OfficialSiteEvidence[]> {
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
  ].slice(0, Math.max(0, Math.min(4, maximumPages) - 1));
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
    bookingLinks: page.bookingLinks,
    ...(page.operatingHours ? { operatingHours: page.operatingHours } : {}),
    ...(page.branchLinks.length ? { branchLinks: page.branchLinks } : {}),
  }));
}

interface ReadPage {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly html: string;
  readonly operatingHours?: string;
  readonly bookingLinks: readonly { label: string; url: string }[];
  readonly branchLinks: readonly {
    url: string;
    name: string;
    address: string;
  }[];
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
    const structured = officialHours(html, page);
    // Group JSON-LD can point to branch pages even on a JavaScript-rendered site.
    // These URLs are discovery hints only; the branch page must be fetched.
    const branchLinks = restaurantRecords(html)
      .flatMap((record) => {
        const destination =
          typeof record.url === 'string'
            ? publicPage(record.url, page)
            : undefined;
        const address = record.address as Record<string, unknown> | undefined;
        const parts = ['addressRegion', 'addressLocality', 'streetAddress'].map(
          (key) => address?.[key],
        );
        return record['@type'] === 'Restaurant' &&
          destination &&
          destination.origin === page.origin &&
          destination.href !== page.href &&
          typeof record.name === 'string' &&
          parts.every((part) => typeof part === 'string' && part)
          ? [
              {
                url: destination.href,
                name: record.name,
                address: parts.join(''),
              },
            ]
          : [];
      })
      .slice(0, 8);
    const bookingLinks = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)]
      .flatMap((match) => {
        const label = plainText(match[2]).slice(0, 80);
        const href = /\bhref\s*=\s*(["'])(.*?)\1/iu.exec(match[1])?.[2];
        const destination = href
          ? publicPage(decodeEntities(href), page, true)
          : undefined;
        return destination &&
          /\b(?:reservations?|reserve now|book a table|book now|booking)\b|予約/iu.test(
            label,
          )
          ? [{ label, url: destination.href }]
          : [];
      })
      .slice(0, 5);
    return content.length >= 20 || structured
      ? {
          url: page.href,
          title,
          content: `${content} ${structured ? `${structured.name} ${structured.address} Official operating hours: ${structured.hours}` : ''} ${bookingLinks.map((link) => `${link.label}: ${link.url}`).join(' ')} Page URL: ${page.href}`,
          bookingLinks,
          branchLinks,
          ...(structured ? { operatingHours: structured.hours } : {}),
          html,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function publicPage(
  value: string,
  base?: URL,
  preserveRoute = false,
): URL | undefined {
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
    if (!preserveRoute) {
      url.hash = '';
      url.search = '';
    }
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

// Read only the current page's Restaurant JSON-LD, never embedded CMS records
// for sister branches. Valid day/time pairs are copied independently of the model.
function restaurantRecords(html: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const script of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    try {
      const data = JSON.parse(script[1]);
      const roots = Array.isArray(data) ? data : [data];
      for (const root of roots)
        if (root && typeof root === 'object') {
          records.push(root);
          if (Array.isArray(root['@graph'])) records.push(...root['@graph']);
        }
    } catch {
      /* Malformed data supplies no facts. */
    }
  }
  return records;
}

function officialHours(
  html: string,
  page: URL,
): { name: string; address: string; hours: string } | undefined {
  const records = restaurantRecords(html);
  const matches = records.filter((record) => {
    try {
      const url = new URL(String(record.url ?? record['@id']));
      url.hash = '';
      return (
        record['@type'] === 'Restaurant' &&
        url.href.replace(/\/$/u, '') === page.href.replace(/\/$/u, '')
      );
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) return undefined;
  const record = matches[0];
  const address = record.address as Record<string, unknown> | undefined;
  const parts = ['addressRegion', 'addressLocality', 'streetAddress'].map(
    (key) => address?.[key],
  );
  if (
    typeof record.name !== 'string' ||
    parts.some((part) => typeof part !== 'string' || !part) ||
    !Array.isArray(record.openingHoursSpecification)
  )
    return undefined;
  const days: Record<string, string> = {
    Monday: '月',
    Tuesday: '火',
    Wednesday: '水',
    Thursday: '木',
    Friday: '金',
    Saturday: '土',
    Sunday: '日',
    PublicHolidays: '祝日',
  };
  const rows = record.openingHoursSpecification.flatMap((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/u.test(String(entry.opens)) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/u.test(String(entry.closes))
    )
      return [];
    const rawDays = Array.isArray(entry.dayOfWeek)
      ? entry.dayOfWeek
      : [entry.dayOfWeek];
    const labels = rawDays.map((day: unknown) =>
      typeof day === 'string'
        ? days[day.replace(/^https?:\/\/schema\.org\//u, '')]
        : undefined,
    );
    return labels.length && labels.every(Boolean)
      ? [`${labels.join('・')} ${entry.opens} - ${entry.closes}`]
      : [];
  });
  return rows.length
    ? { name: record.name, address: parts.join(''), hours: rows.join('; ') }
    : undefined;
}
