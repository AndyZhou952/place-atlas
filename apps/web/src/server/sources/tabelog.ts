import { tabelogListingUrl } from '../../shared/text.ts';
import { readBoundedText } from '../http.ts';
import { decodeEntities } from './search.ts';

/** Facts read from one exact Tabelog main listing. Reviews are never read. */
export interface TabelogListing {
  readonly url: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly address: string;
  readonly area: string;
  readonly postalCode?: string;
  readonly score?: number;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly categories: readonly string[];
  readonly reservation?: string;
  readonly bookingUrl?: string;
  readonly officialUrl?: string;
  readonly openingHours?: string;
  readonly regularClosingDays?: string;
  readonly closingNotes?: string;
  readonly introduction?: string;
}

export type ListingRead =
  | { readonly kind: 'read'; readonly listing: TabelogListing }
  | { readonly kind: 'blocked' | 'unavailable' };

const isChallenge = (html: string) =>
  /<title[^>]*>\s*(?:Just a moment|現在アクセスが集中)|cf-chl-|cf_chl_/iu.test(html);

/** Read through Firecrawl when selected (Tabelog often refuses Worker IPs), then directly. */
export async function readTabelogListing(
  url: string,
  options: {
    readonly firecrawl?: boolean;
    readonly firecrawlKey?: string;
    readonly fetch?: typeof fetch;
  } = {},
): Promise<ListingRead> {
  const target = tabelogListingUrl(url);
  if (!target) return { kind: 'unavailable' };
  const fetcher = options.fetch ?? fetch;
  let first: ListingRead | undefined;
  if (options.firecrawl) {
    first = await readViaFirecrawl(target, fetcher, options.firecrawlKey);
    if (first.kind === 'read' && first.listing.latitude !== undefined) return first;
  }
  const direct = await readDirect(target, fetcher);
  return direct.kind !== 'unavailable' || !first ? direct : first;
}

async function readDirect(url: string, fetcher: typeof fetch): Promise<ListingRead> {
  try {
    const response = await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'text/html', 'user-agent': 'JapanAtlas/1.0' },
    });
    if ([401, 403, 429].includes(response.status)) return { kind: 'blocked' };
    if (!response.ok) return { kind: 'unavailable' };
    return parsed(await readBoundedText(response, 2_097_152), url);
  } catch {
    return { kind: 'unavailable' };
  }
}

async function readViaFirecrawl(
  url: string,
  fetcher: typeof fetch,
  apiKey?: string,
): Promise<ListingRead> {
  try {
    const response = await fetcher('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        url,
        formats: ['rawHtml'],
        onlyMainContent: false,
        maxAge: 0,
        timeout: 15_000,
        proxy: 'basic',
      }),
    });
    if (!response.ok) return { kind: 'unavailable' };
    const { data } = JSON.parse(await readBoundedText(response, 4_194_304));
    const status = Number(data?.metadata?.statusCode);
    if ([401, 403, 429].includes(status)) return { kind: 'blocked' };
    // The final page must still be the requested listing.
    if (
      status !== 200 ||
      typeof data?.rawHtml !== 'string' ||
      tabelogListingUrl(data.metadata.url) !== url
    ) {
      return { kind: 'unavailable' };
    }
    return parsed(data.rawHtml, url);
  } catch {
    return { kind: 'unavailable' };
  }
}

function parsed(html: string, url: string): ListingRead {
  if (isChallenge(html)) return { kind: 'blocked' };
  const listing = parseTabelogListing(html, url);
  return listing ? { kind: 'read', listing } : { kind: 'unavailable' };
}

const clean = (html: string) =>
  decodeEntities(html.replace(/<[^>]*>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
const CALENDAR_CLOSURE = /年末|年始|元旦|元日|お盆|夏季|冬季|\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2}/u;

/** Parse the listing's Restaurant JSON-LD and its own business-info table rows. */
export function parseTabelogListing(html: string, sourceUrl: string): TabelogListing | undefined {
  const url = tabelogListingUrl(sourceUrl);
  if (!url) return undefined;
  const records: Record<string, unknown>[] = [];
  for (const [, body] of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/giu,
  )) {
    try {
      for (const root of [JSON.parse(body)].flat()) {
        if (root && typeof root === 'object')
          records.push(root, ...(Array.isArray(root['@graph']) ? root['@graph'] : []));
      }
    } catch {
      // An invalid block supplies no evidence.
    }
  }
  const matches = records.filter(
    (entry) =>
      entry['@type'] === 'Restaurant' && tabelogListingUrl(entry['@id'] ?? entry.url) === url,
  );
  // Several records for one listing would need adjudication, not an arbitrary choice.
  if (matches.length !== 1) return undefined;
  const restaurant = matches[0];
  const address = (restaurant.address ?? {}) as Record<string, unknown>;
  const parts = [address.addressRegion, address.addressLocality, address.streetAddress];
  const name = typeof restaurant.name === 'string' ? restaurant.name.trim() : '';
  if (!name || parts.some((part) => typeof part !== 'string' || !part.trim())) return undefined;
  // A new listing may have no aggregate yet; a malformed one invalidates the record.
  const rating = restaurant.aggregateRating as Record<string, unknown> | undefined;
  const score = rating ? Number(rating.ratingValue) : undefined;
  const validScore =
    !rating ||
    (rating['@type'] === 'AggregateRating' &&
      /^\d(?:\.\d{1,2})?$/u.test(String(rating.ratingValue)) &&
      score! >= 1 &&
      score! <= 5);
  if (!validScore || typeof rating?.ratingValue === 'boolean') return undefined;
  const geo = (restaurant.geo ?? {}) as Record<string, unknown>;
  const row = (label: string) =>
    new RegExp(`<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'iu').exec(
      html,
    )?.[1];
  // Latin aliases come only from the listing's own 店名 row, e.g. "鮨 青空 (Sushi Aozora)".
  const displayedName = clean(row('店名') ?? '');
  const aliases = displayedName.startsWith(name)
    ? [...displayedName.slice(name.length).matchAll(/[（(]([^（）()<>]{2,100})[）)]/gu)]
        .map((m) => m[1].trim())
        .slice(0, 3)
    : [];
  const reservation = clean(row('予約可否') ?? '').slice(0, 1000);
  const bookingLinks = [
    ...`${row('予約可否') ?? ''} ${row('備考') ?? ''}`.matchAll(
      /<a\b[^>]*href=["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu,
    ),
  ]
    .filter(([, , label]) => /予約|reserve|book|tablecheck|toreta/iu.test(clean(label)))
    .map(([, href]) => decodeEntities(href));
  const officialUrl = /href=["'](https:\/\/[^"']+)["']/iu.exec(row('ホームページ') ?? '')?.[1];
  const introduction = clean(
    row('お店のPR') ??
      /<p\b[^>]*class=["'][^"']*\bpr-comment\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/iu.exec(html)?.[1] ??
      '',
  )
    .replace(/続きを読む/gu, '')
    .slice(0, 1200);
  const schedule = parseSchedule(row('営業時間(?:・定休日)?'), row('定休日'), records, url);
  return {
    url,
    name,
    aliases,
    address: parts.join(''),
    area: `${parts[1]}${String(parts[2]).split(/[0-9０-９]/u)[0]}`.trim(),
    ...(/^\d{7}$/u.test(String(address.postalCode))
      ? { postalCode: String(address.postalCode) }
      : {}),
    ...(score === undefined ? {} : { score }),
    ...(typeof geo.latitude === 'number' && typeof geo.longitude === 'number'
      ? { latitude: geo.latitude, longitude: geo.longitude }
      : {}),
    categories: (typeof restaurant.servesCuisine === 'string'
      ? restaurant.servesCuisine.split(/[、,]/u)
      : []
    )
      .map(clean)
      .filter(Boolean)
      .slice(0, 8),
    ...(reservation ? { reservation } : {}),
    ...(bookingLinks.length === 1 ? { bookingUrl: bookingLinks[0] } : {}),
    ...(officialUrl ? { officialUrl: decodeEntities(officialUrl) } : {}),
    ...schedule,
    ...(introduction ? { introduction } : {}),
  };
}

/** Hours and closing rules from the exact listing's business-info rows only. */
function parseSchedule(
  hoursRow: string | undefined,
  closingRow: string | undefined,
  records: readonly Record<string, unknown>[],
  url: string,
): Pick<TabelogListing, 'openingHours' | 'regularClosingDays' | 'closingNotes'> {
  const businessOther =
    /<div\b[^>]*class=["'][^"']*rstinfo-table__business-other[^"']*["'][^>]*>[\s\S]*?<\/div>/iu.exec(
      hoursRow ?? '',
    )?.[0];
  // A note advertising a sister branch must not replace this restaurant's rows.
  const otherBranch =
    !!businessOther &&
    /[市区][^\s<]{0,30}\d[-－]\d[-－]\d/u.test(clean(businessOther)) &&
    /店|branch/iu.test(clean(businessOther));
  const scheduleRow = otherBranch ? (hoursRow ?? '').replace(businessOther, '') : hoursRow;
  let openingHours = scheduleRow ? clean(scheduleRow).slice(0, 1200) : undefined;
  const dayTitles = [
    ...(scheduleRow ?? '').matchAll(
      /<p\b[^>]*class=["'][^"']*rstinfo-table__business-title[^"']*["'][^>]*>([\s\S]*?)<\/p>(?:\s*<ul\b[^>]*>([\s\S]*?)<\/ul>)?/giu,
    ),
  ];
  // A same-listing FAQ answer may make unlabeled clock ranges explicit by weekday; it must
  // repeat exactly the same clock times, never override them.
  const clocks = (value: string) =>
    [
      ...new Set(
        value
          .normalize('NFKC')
          .split(/■\s*定休日/u)[0]
          .match(/\d{1,2}:\d{2}/gu) ?? [],
      ),
    ]
      .sort()
      .join('|');
  if (
    openingHours &&
    !otherBranch &&
    !dayTitles.some(([, title]) => /[月火水木金土日祝]/u.test(clean(title)))
  ) {
    for (const faq of records.filter((entry) => entry['@type'] === 'FAQPage')) {
      for (const question of Array.isArray(faq.mainEntity) ? faq.mainEntity : []) {
        const answer = question?.acceptedAnswer?.text;
        if (question?.name !== '営業時間・定休日を教えてください' || typeof answer !== 'string')
          continue;
        const linked = /href\s*=\s*["']?(https:\/\/tabelog\.com\/[^\s"'>]+)/u.exec(answer)?.[1];
        const textAnswer = clean(answer.replace(/<a\b[\s\S]*?<\/a>/giu, ''));
        if (
          tabelogListingUrl(linked) === url &&
          /\[(?:月|火|水|木|金|土|日)\]/u.test(textAnswer) &&
          textAnswer.length <= 1200 &&
          clocks(textAnswer) === clocks(openingHours) &&
          /24時間営業/u.test(textAnswer) === /24時間営業/u.test(openingHours)
        ) {
          openingHours = textAnswer;
        }
      }
    }
  }
  const closedDays = dayTitles
    .filter(([, , items]) => items && clean(items) === '定休日')
    .map(([, title]) => clean(title));
  const lines = (otherBranch ? '' : (closingRow ?? businessOther ?? scheduleRow ?? ''))
    .replace(/<br\s*\/?>/giu, '\n')
    .split('\n')
    .map(clean)
    .filter(Boolean);
  const closureNote =
    clean(closingRow ?? '') ||
    lines
      .map(
        (line, index) =>
          /^■\s*定休日\s*(.+)$/u.exec(line)?.[1] ??
          (/^■\s*定休日\s*$/u.test(lines[index - 1] ?? '') && !line.startsWith('■')
            ? line
            : undefined),
      )
      .find(Boolean);
  // One note can hold both a weekly rule and dated closures; keep the calendar part separate.
  const weekly = closureNote
    ?.split(CALENDAR_CLOSURE)[0]
    .replace(/[（(、。，,\s]+$/u, '')
    .trim();
  const policy =
    (weekly &&
    /毎週|[月火水木金土日](?:曜|祝)|祝日|無休|不定休|無し|なし|施設|準ずる|open\s*7\s*days/iu.test(
      weekly,
    )
      ? weekly
      : undefined) ??
    (!closureNote
      ? /年中無休|不定休|Open\s*7\s*days\s*a\s*week(?:[^。]{0,80})?|商業施設に準ずる/iu.exec(
          openingHours ?? '',
        )?.[0]
      : undefined);
  const facility = lines.find((line) =>
    /^\d+F(?:カフェ|喫茶|サロン|レストラン|ショップ|売店)[^■]{0,50}$/u.test(line.normalize('NFKC')),
  );
  const holidayExceptions = closedDays.length
    ? lines.filter(
        (line) =>
          /定休/u.test(line) &&
          /祝日|祝祭日/u.test(line) &&
          /場合|振替|翌|除く|除外|営業/u.test(line) &&
          !/\d{1,2}:\d{2}/u.test(line) &&
          !line.startsWith('■'),
      )
    : [];
  const regularClosingDays = [
    ...new Set([
      ...closedDays,
      ...(policy ? [facility ? `${facility}：${policy}` : policy] : []),
      ...holidayExceptions,
    ]),
  ].join(' / ');
  const closingNotes =
    [
      ...new Set(
        lines
          .filter(
            (line) =>
              CALENDAR_CLOSURE.test(line) && /休業|休み|休暇|店休日|定休日|無休|不定休/u.test(line),
          )
          .map((line) =>
            weekly && line === closureNote
              ? line
                  .slice(weekly.length)
                  .trim()
                  .replace(/^[（(](.*)[）)]$/u, '$1')
              : line,
          ),
      ),
    ].join(' / ') ||
    (closureNote && !policy && /休|年末|年始|元旦|元日/u.test(closureNote) ? closureNote : '');
  return {
    ...(openingHours ? { openingHours } : {}),
    ...(regularClosingDays ? { regularClosingDays } : {}),
    ...(closingNotes ? { closingNotes } : {}),
  };
}
