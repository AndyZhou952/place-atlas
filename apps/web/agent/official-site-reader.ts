import type { SearchEvidence } from './web-search.ts';
import { readBoundedText } from './web-search.ts';

export interface OfficialSiteEvidence extends SearchEvidence {
  readonly bookingLinks: readonly { label: string; url: string }[];
  readonly operatingHours?: string;
  readonly regularClosingDays?: string;
  readonly branchLinks?: readonly {
    url: string;
    name: string;
    address: string;
  }[];
}

export interface OfficialBranchIdentity {
  readonly name: string;
  readonly address: string;
}

/** Read at most four pages on one public HTTPS origin, without credentials or redirects. */
export async function readOfficialSite(
  websiteUri: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  maximumPages = 4,
  expectedBranch?: OfficialBranchIdentity,
): Promise<OfficialSiteEvidence[]> {
  const root = publicPage(websiteUri);
  if (!root) return [];
  const first = await readPage(root, signal, fetcher, expectedBranch);
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
    selected.map(({ page }) => readPage(page, signal, fetcher, expectedBranch)),
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
    ...(page.regularClosingDays
      ? { regularClosingDays: page.regularClosingDays }
      : {}),
    ...(page.branchLinks.length ? { branchLinks: page.branchLinks } : {}),
  }));
}

interface ReadPage {
  readonly url: string;
  readonly title: string;
  readonly content: string;
  readonly html: string;
  readonly operatingHours?: string;
  readonly regularClosingDays?: string;
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
  expectedBranch?: OfficialBranchIdentity,
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
    const regularClosingDays = officialRegularClosingDays(
      html,
      page,
      expectedBranch,
    );
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
          content: `${content} ${structured ? `${structured.name} ${structured.address} Official operating hours: ${structured.hours}` : ''} ${regularClosingDays ? `Official regular closing days: ${regularClosingDays}` : ''} ${bookingLinks.map((link) => `${link.label}: ${link.url}`).join(' ')} Page URL: ${page.href}`,
          bookingLinks,
          branchLinks,
          ...(structured ? { operatingHours: structured.hours } : {}),
          ...(regularClosingDays ? { regularClosingDays } : {}),
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

function officialRegularClosingDays(
  html: string,
  page: URL,
  expectedBranch?: OfficialBranchIdentity,
): string | undefined {
  // Prefer one address-bearing Restaurant record whose URL is this exact
  // branch page. Some official microsites omit JSON-LD; callers can instead
  // provide identity from a previously verified exact-branch listing.
  const records = restaurantRecords(html);
  const matches = records.filter((record) => {
    try {
      const url = new URL(String(record.url ?? record['@id']));
      url.hash = '';
      const address = record.address as Record<string, unknown> | undefined;
      return (
        record['@type'] === 'Restaurant' &&
        url.href.replace(/\/$/u, '') === page.href.replace(/\/$/u, '') &&
        typeof record.name === 'string' &&
        ['addressRegion', 'addressLocality', 'streetAddress'].every(
          (key) => typeof address?.[key] === 'string' && address[key],
        )
      );
    } catch {
      return false;
    }
  });
  if (matches.length > 1) return undefined;
  if (matches.length === 1) {
    if (
      expectedBranch &&
      !matchesExpectedBranchRecord(matches[0], expectedBranch)
    )
      return undefined;
  } else if (
    !expectedBranch ||
    !matchesExpectedBranchMarkup(html, expectedBranch)
  ) {
    return undefined;
  }
  const currentUrl = page.href.replace(/\/$/u, '');
  const hasOtherAddressedBranch = records.some((record) => {
    try {
      const url = new URL(String(record.url ?? record['@id']));
      url.hash = '';
      const address = record.address as Record<string, unknown> | undefined;
      return (
        record['@type'] === 'Restaurant' &&
        url.href.replace(/\/$/u, '') !== currentUrl &&
        ['addressRegion', 'addressLocality', 'streetAddress'].every(
          (key) => typeof address?.[key] === 'string' && address[key],
        )
      );
    } catch {
      return false;
    }
  });
  // A page containing sibling-branch Restaurant records has global markup;
  // without a branch-scoped closure container the label could refer to either.
  if (hasOtherAddressedBranch) return undefined;

  const values = [
    ...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/giu),
  ].flatMap((row) => {
    const cells = [
      ...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>/giu),
    ].map((cell) => plainText(cell[1]));
    return cells.length >= 2 &&
      cells[0].replace(/[：:]/gu, '') === '定休日' &&
      cells[1] &&
      cells[1].length <= 250
      ? [cells[1]]
      : [];
  });
  const unique = [...new Set(values)];
  if (unique.length !== 1) return undefined;
  const value = unique[0];
  // Require an explicit no-closure, irregular, or weekday policy. Annual and
  // seasonal-only strings such as 年末年始 or 夏季休業 stay out of this field.
  if (!hasExplicitWeeklyClosurePolicy(value)) return undefined;
  return value;
}

function matchesExpectedBranchRecord(
  record: Record<string, unknown>,
  expected: OfficialBranchIdentity,
): boolean {
  const address = record.address as Record<string, unknown> | undefined;
  const recordName =
    typeof record.name === 'string'
      ? plainText(record.name).replace(/\s+/gu, '')
      : '';
  const expectedName = plainText(expected.name).replace(/\s+/gu, '');
  const recordAddress = [
    address?.addressRegion,
    address?.addressLocality,
    address?.streetAddress,
  ]
    .filter((part): part is string => typeof part === 'string')
    .join('');
  return (
    recordName === expectedName &&
    matchesExpectedAddress(recordAddress, expected.address)
  );
}

function matchesExpectedBranchMarkup(
  html: string,
  expected: OfficialBranchIdentity,
): boolean {
  const headings = [
    ...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/giu),
  ].map((heading) => plainText(heading[1]).replace(/\s+/gu, ''));
  const expectedName = plainText(expected.name).replace(/\s+/gu, '');
  if (
    !expectedName ||
    !headings.some((heading) => heading.includes(expectedName))
  )
    return false;

  const addressRows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/giu)]
    .map((row) =>
      [
        ...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>/giu),
      ].map((cell) => plainText(cell[1])),
    )
    .filter(
      (cells) =>
        cells.length >= 2 && cells[0].replace(/[：:]/gu, '') === '住所',
    );
  return (
    addressRows.length === 1 &&
    matchesExpectedAddress(addressRows[0][1], expected.address)
  );
}

function matchesExpectedAddress(source: string, expected: string): boolean {
  const normalize = (value: string) =>
    plainText(value)
      .replace(/[０-９]/gu, (digit) =>
        String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
      )
      .replace(/\s+/gu, '');
  const expectedAddress = normalize(expected);
  const expectedNumber = /\d+-\d+-\d+/u.exec(expectedAddress);
  if (!expectedNumber || expectedNumber.index === undefined) return false;
  const expectedCore = expectedAddress.slice(
    0,
    expectedNumber.index + expectedNumber[0].length,
  );
  const sourceAddress = normalize(source);
  if (!sourceAddress.startsWith(expectedCore)) return false;
  const remainder = sourceAddress.slice(expectedCore.length);
  // Permit the source to omit building details or add a building suffix, but
  // never accept a longer/different street number such as 5-33-160.
  return !/^[\d-]/u.test(remainder);
}

function hasExplicitWeeklyClosurePolicy(value: string): boolean {
  if (/無休|年中無休|無し|なし|定休日なし|休業日なし|不定休/u.test(value))
    return true;
  if (/(?:月|火|水|木|金|土|日)曜日|(?:月|火|水|木|金|土|日)曜/u.test(value))
    return true;
  if (
    /(?:^|[、・,，/（(\s])[月火水木金土日](?=$|[、・,，/（）)\s])/u.test(value)
  )
    return true;
  // Compact explicit weekday lists, e.g. 土日祝 or 月火水木金.
  return /^[月火水木金土日]+(?:祝日?|祝前日|祝後日)?(?:定休日?|休業|休み)?$/u.test(
    value,
  );
}
