import { isTabelogRestaurantListing } from './instructions.ts';
import { readBoundedText, type SearchEvidence } from './web-search.ts';

export interface TabelogEvidence extends SearchEvidence {
  englishListingUrl?: string;
  nameBridge?: {
    name: string;
    japaneseName: string;
    address: string;
    postalCode?: string;
  };
  restaurant?: {
    name: string;
    aliases?: string[];
    address: string;
    postalCode?: string;
    area: string;
    score?: number;
    coordinates?: { latitude: number; longitude: number };
    categories: string[];
    reservation?: string;
    bookingProviderHint?: 'tablecheck' | 'toreta';
    bookingLink?: string;
    openingHours?: string;
    regularClosingDays?: string;
    closingNotes?: string;
    officialWebsite?: string;
    introduction?: string;
  };
}

export type TabelogReadResult =
  | { kind: 'read'; evidence: TabelogEvidence }
  | { kind: 'blocked' | 'unavailable' | 'invalid_source' };

/** An HTTP 200 challenge is still a refused source read, not an empty restaurant. */
export function isTabelogAccessChallenge(html: string): boolean {
  return /<title[^>]*>\s*(?:Just a moment|現在アクセスが集中)|cf-chl-|cf_chl_/iu.test(html);
}

/**
 * Only a discovered main listing on a fixed public host, never arbitrary model URLs. Keep access
 * failures distinct from a successfully read page with missing facts.
 */
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
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel();
      return { kind: 'unavailable' };
    }
    const html = await readBoundedText(response, 1_048_576);
    if (isTabelogAccessChallenge(html)) return { kind: 'blocked' };
    const evidence = parseTabelogListing(html, url);
    return evidence ? { kind: 'read', evidence } : { kind: 'invalid_source' };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Discard reviews entirely; only Restaurant.aggregateRating can supply a score. */
export function parseTabelogListing(html: string, sourceUrl: string): TabelogEvidence | undefined {
  if (!isTabelogRestaurantListing(sourceUrl)) return undefined;
  const identity = (value: string) => new URL(value).pathname.replace(/\/$/u, '');
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
  const postalCode =
    typeof address?.postalCode === 'string' && /^\d{7}$/u.test(address.postalCode)
      ? address.postalCode
      : undefined;
  // Localized pages can omit JSON-LD streetAddress. Read only their paired
  // header names and explicit address row as an identity bridge, never as a
  // substitute source of Japanese listing facts.
  if (new URL(sourceUrl).pathname.startsWith('/en/')) {
    const clean = (value: string) =>
      value
        .replace(/<[^>]*>/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const header =
      /<h2\b[^>]*class=["']display-name["'][^>]*>([\s\S]*?)<\/h2>\s*<span\b[^>]*class=["']alias["'][^>]*>[（(]([^<>]+)[）)]<\/span>/iu.exec(
        html,
      );
    const addressRow = /<th[^>]*>\s*Address\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/iu.exec(html)?.[1];
    const street =
      addressRow &&
      /<p\b[^>]*class=["']rstinfo-table__address["'][^>]*>([\s\S]*?)<\/p>/iu.exec(addressRow)?.[1];
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const japaneseName = header?.[2]?.trim();
    const listedAddress = street && clean(street);
    if (
      !header ||
      clean(header[1]) !== name ||
      !name ||
      name.length > 300 ||
      !japaneseName ||
      japaneseName.length > 300 ||
      !listedAddress ||
      listedAddress.length > 500
    )
      return undefined;
    return {
      url: sourceUrl,
      title: name,
      content: `${name} (${japaneseName}) ${listedAddress}`,
      nameBridge: {
        name,
        japaneseName,
        address: listedAddress,
        ...(postalCode ? { postalCode } : {}),
      },
    };
  }
  const rating = record.aggregateRating as Record<string, unknown> | undefined;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const parts = ['addressRegion', 'addressLocality', 'streetAddress'].map((key) => address?.[key]);
  if (
    !name ||
    name.length > 300 ||
    parts.some((part) => typeof part !== 'string' || !part.trim() || part.length > 500)
  )
    return undefined;
  // A new listing can have a verified identity and address before it has an
  // aggregate score. Review-level ratings must never fill that gap.
  let score: number | undefined;
  if (rating !== undefined) {
    if (rating['@type'] !== 'AggregateRating') return undefined;
    const rawScore = rating.ratingValue;
    if (
      !['number', 'string'].includes(typeof rawScore) ||
      !/^\d(?:\.\d{1,2})?$/u.test(String(rawScore))
    )
      return undefined;
    score = Number(rawScore);
    if (score < 1 || score > 5) return undefined;
  }
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
    new RegExp(`<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'iu').exec(
      html,
    )?.[1];
  // The Restaurant JSON-LD name can be Japanese-only while the same page's
  // The restaurant-name row supplies an official Latin alias. Bind it to that row and to the
  // structured restaurant name; never mine reviews or unrelated page text.
  const displayedName = clean(row('店名') ?? '');
  const aliases = displayedName.startsWith(name)
    ? [...displayedName.slice(name.length).matchAll(/[（(]([^（）()]{2,100})[）)]/gu)]
        .map((match) => match[1].trim())
        .filter((alias) => alias && !/[<>\p{Cc}]/u.test(alias))
        .slice(0, 3)
    : [];
  const reservation = clean(row('予約可否') ?? '').slice(0, 1000);
  const remarks = clean(row('備考') ?? '').slice(0, 1000);
  const introduction = clean(
    row('お店のPR') ??
      /<p\b[^>]*class=["'][^"']*\bpr-comment\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/iu.exec(html)?.[1] ??
      '',
  )
    .replace(/続きを読む/gu, '')
    .trim()
    .slice(0, 1200);
  // Operating hours come only from the exact listing's business-info row,
  // never from review text, booking slot availability, or a last-order time.
  const hoursRow = row('営業時間(?:・定休日)?');
  const businessOther =
    /<div\b[^>]*class=["'][^"']*rstinfo-table__business-other[^"']*["'][^>]*>([\s\S]*?)<\/div>/iu.exec(
      hoursRow ?? '',
    )?.[0];
  // Some listings advertise a sister branch in this note. Its address and
  // schedule must never replace the structured weekly rows for this restaurant.
  const otherBranch =
    businessOther &&
    /[市区][^\s<]{0,30}\d[-－]\d[-－]\d/u.test(clean(businessOther)) &&
    /(?:店|branch)/iu.test(clean(businessOther));
  const scheduleRow = otherBranch ? (hoursRow ?? '').replace(businessOther, '') : hoursRow;
  let openingHours = scheduleRow ? clean(scheduleRow).slice(0, 1200) : undefined;
  const hasStructuredDayRows = [
    ...(scheduleRow ?? '').matchAll(
      /<p\b[^>]*class=["'][^"']*rstinfo-table__business-title[^"']*["'][^>]*>([\s\S]*?)<\/p>/giu,
    ),
  ].some((match) => /[月火水木金土日祝]/u.test(clean(match[1])));
  // A same-listing hours FAQ can make an unqualified clock range explicit by
  // weekday. It must corroborate the business row, never override its clocks.
  if (
    openingHours &&
    !otherBranch &&
    !hasStructuredDayRows &&
    !/(?:[月火水木金土日](?:・|曜)|\[月\])/u.test(openingHours.split(/■\s*定休日/u)[0])
  ) {
    const timeFacts = (value: string) =>
      [
        ...new Set(
          [
            ...value
              .normalize('NFKC')
              .split(/■\s*定休日/u)[0]
              .matchAll(/\d{1,2}:\d{2}/gu),
          ].map((match) => match[0]),
        ),
      ]
        .sort((a, b) => a.localeCompare(b))
        .join('|');
    for (const faq of records.filter((entry) => entry['@type'] === 'FAQPage')) {
      if (!Array.isArray(faq.mainEntity)) continue;
      for (const question of faq.mainEntity) {
        if (
          !question ||
          question.name !== '営業時間・定休日を教えてください' ||
          typeof question.acceptedAnswer?.text !== 'string'
        )
          continue;
        const answer = question.acceptedAnswer.text;
        const linked = /href\s*=\s*["']?(https:\/\/tabelog\.com\/[^\s"'>]+)/u.exec(answer)?.[1];
        if (
          !linked ||
          !isTabelogRestaurantListing(linked) ||
          identity(linked) !== identity(sourceUrl)
        )
          continue;
        const text = clean(answer.replace(/<a\b[\s\S]*?<\/a>/giu, ''));
        if (
          text &&
          text.length <= 1200 &&
          /\[(?:月|火|水|木|金|土|日)\]/u.test(text) &&
          timeFacts(text) === timeFacts(openingHours) &&
          /24時間営業/u.test(text) === /24時間営業/u.test(openingHours)
        )
          openingHours = text;
      }
    }
  }
  const closedItems = [
    ...(scheduleRow ?? '').matchAll(
      /<p\b[^>]*class=["'][^"']*rstinfo-table__business-title[^"']*["'][^>]*>([\s\S]*?)<\/p>\s*<ul\b[^>]*>([\s\S]*?)<\/ul>/giu,
    ),
  ]
    .filter((match) => clean(match[2]) === '定休日')
    .map((match) => clean(match[1]));
  const lines = (otherBranch ? '' : (row('定休日') ?? businessOther ?? scheduleRow ?? ''))
    .replace(/<br\s*\/?>/giu, '\n')
    .split('\n')
    .map(clean)
    .filter(Boolean);
  const closureNote =
    clean(row('定休日') ?? '') ||
    lines
      .map(
        (line, index) =>
          /^■\s*定休日\s*(.+)$/u.exec(line)?.[1] ??
          (/^■\s*定休日\s*$/u.test(lines[index - 1] ?? '') && !line.startsWith('■')
            ? line
            : undefined),
      )
      .find(Boolean);
  // A single note may contain both a weekly rule and dated/seasonal closures.
  // Keep the calendar suffix out of the recurring policy.
  const weeklyPolicyText = closureNote
    ?.split(/年末|年始|元旦|元日|お盆|夏季|冬季|\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2}/u)[0]
    .replace(/[（(、。，,\s]+$/u, '')
    .trim();
  const explicitPolicy =
    weeklyPolicyText &&
    /毎週|[月火水木金土日](?:曜|祝)|祝日|無休|不定休|無し|なし|施設|準ずる|open\s*7\s*days/iu.test(
      weeklyPolicyText,
    )
      ? weeklyPolicyText
      : undefined;
  const facilityLabel = lines.find((line) =>
    /^\d+F(?:カフェ|喫茶|サロン|レストラン|ショップ|売店)[^■]{0,50}$/u.test(line.normalize('NFKC')),
  );
  const standalonePolicy =
    !closureNote &&
    /(?:年中無休|不定休|Open\s*7\s*days\s*a\s*week(?:[^。]{0,80})?|商業施設に準ずる)/iu.exec(
      openingHours ?? '',
    )?.[0];
  const exceptions = closedItems.length
    ? lines.filter(
        (line) =>
          /定休日|定休/u.test(line) &&
          /祝日|祝祭日/u.test(line) &&
          /場合|振替|翌|除く|除外|営業/u.test(line) &&
          !/\d{1,2}:\d{2}/u.test(line) &&
          !line.startsWith('■'),
      )
    : [];
  const regularClosingDays = [
    ...new Set([
      ...closedItems,
      ...(explicitPolicy || standalonePolicy
        ? [
            facilityLabel
              ? `${facilityLabel}：${explicitPolicy ?? standalonePolicy}`
              : (explicitPolicy ?? standalonePolicy),
          ]
        : []),
      ...exceptions,
    ]),
  ].join(' / ');
  // Calendar-period closures are optional notes, never a guessed weekly policy.
  const closingNotes =
    [
      ...new Set(
        lines
          .filter(
            (line) =>
              /年末|年始|元旦|元日|お盆|夏季|冬季|\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2}/u.test(
                line,
              ) && /休業|休み|休暇|店休日|休みとな|定休日|無休|不定休/u.test(line),
          )
          .map((line) =>
            weeklyPolicyText && line === closureNote
              ? line
                  .slice(weeklyPolicyText.length)
                  .trim()
                  .replace(/^[（(](.*)[）)]$/u, '$1')
              : line,
          ),
      ),
    ].join(' / ') ||
    (closureNote && !explicitPolicy && /休|年末|年始|元旦|元日/u.test(closureNote)
      ? closureNote
      : undefined);
  const officialRow = row('ホームページ');
  const website = officialRow && /href=["'](https:\/\/[^"']+)["']/iu.exec(officialRow)?.[1];
  // Only restaurant-info rows can declare a destination; reviews and ads cannot.
  const bookingLinks = [
    ...`${row('予約可否') ?? ''} ${row('備考') ?? ''}`.matchAll(
      /<a\b[^>]*href=["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu,
    ),
  ]
    .filter((match) => /予約|reserve|book|tablecheck|toreta/iu.test(clean(match[2])))
    .map((match) => clean(match[1]));
  const bookingLink = bookingLinks.length === 1 ? bookingLinks[0] : undefined;
  const categories = (
    typeof record.servesCuisine === 'string' ? record.servesCuisine.split(/[、,]/u) : []
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
    aliases,
    address: parts.join(''),
    ...(postalCode ? { postalCode } : {}),
    ...(score === undefined ? {} : { score }),
    categories,
    area: `${String(parts[1])}${String(parts[2]).split(/[0-9０-９]/u)[0]}`.trim(),
    ...(coordinates ? { coordinates } : {}),
    ...(reservation ? { reservation } : {}),
    ...(/Table\s*Check/iu.test(remarks) ? { bookingProviderHint: 'tablecheck' as const } : {}),
    ...(bookingLink ? { bookingLink } : {}),
    ...(/トレタ|toreta/iu.test(remarks + reservation)
      ? { bookingProviderHint: 'toreta' as const }
      : {}),
    ...(openingHours ? { openingHours } : {}),
    ...(regularClosingDays ? { regularClosingDays } : {}),
    ...(closingNotes ? { closingNotes } : {}),
    ...(introduction ? { introduction } : {}),
    ...(website ? { officialWebsite: clean(website) } : {}),
  };
  const englishUrl = new URL(sourceUrl);
  englishUrl.pathname = '/en' + englishUrl.pathname;
  englishUrl.search = '';
  englishUrl.hash = '';
  const hasEnglishAlternate = [...html.matchAll(/<link\b[^>]*>/giu)].some(
    ([tag]) =>
      /\brel=["']alternate["']/iu.test(tag) &&
      /\bhreflang=["']en["']/iu.test(tag) &&
      /\bhref=["']([^"']+)["']/iu.exec(tag)?.[1] === englishUrl.href,
  );
  return {
    ...(hasEnglishAlternate ? { englishListingUrl: englishUrl.href } : {}),
    url: sourceUrl,
    title: name,
    content: `${[name, ...aliases, parts.join('')].join(' ')}${score === undefined ? '' : `\nTabelog aggregate restaurant rating: ${score.toFixed(2)}`}\nRestaurant facts: ${JSON.stringify(restaurant)}`,
    restaurant,
  };
}
