// Booking pages and booking windows: TableCheck and Toreta merchant pages for the selected branch,
// and the explicit "how far ahead" rule extracted from booking text (never inferred).
import { readBoundedText, type SearchEvidence } from './web-search.ts';

export interface ExplicitReservationTiming {
  readonly advanceDays?: number;
  readonly bookingWindowLabel?: string;
  readonly releaseNote?: string;
}

/** Extract only an explicitly stated booking opening window, not a deadline. */
export function explicitReservationTiming(sourceText: string): ExplicitReservationTiming {
  const text = sourceText.normalize('NFKC');
  const bookingContext = (index: number, length: number) => {
    const before = text.slice(0, index);
    const start = Math.max(
      before.lastIndexOf('。'),
      before.lastIndexOf('.'),
      before.lastIndexOf('!'),
      before.lastIndexOf('?'),
    );
    const after = text.slice(index + length);
    const nextBoundary = after.search(/[。.!?]/u);
    const clause = text.slice(
      start + 1,
      nextBoundary < 0 ? undefined : index + length + nextBoundary,
    );
    return /予約|受付|book|reserv/iu.test(clause);
  };
  const japaneseRelease =
    /(?:毎月|各月)\s*\d{1,2}日(?:の)?\s*(?:午前|午後)?\s*\d{1,2}(?::[0-5]\d|時(?:[0-5]?\d分)?)\s*(?:から|より)\s*(?:(?:翌月|当月)分の)?(?:ご?予約)?受付(?:を)?開始/u.exec(
      text,
    );
  const englishRelease =
    /\b(?:Bookings|Reservations)\s+for\s+the\s+(?:following|next)\s+month\s+open\s+at\s+\d{1,2}:[0-5]\d\s+on\s+the\s+\d{1,2}(?:st|nd|rd|th)\s+of\s+each\s+month\b/iu.exec(
      text,
    );
  const releaseMatch = japaneseRelease ?? englishRelease;
  const releaseNote =
    releaseMatch && bookingContext(releaseMatch.index, releaseMatch[0].length)
      ? { releaseNote: releaseMatch[0].trim() }
      : {};
  const merchantMonth = /毎月\s*\d{1,2}日\s*に\s*翌月末日\s*までの\s*ご?予約を承ります/u.exec(text);
  if (merchantMonth) {
    const releaseClock =
      /(?:公式HP|オンライン|WEB)\s*[:：]\s*(毎月\s*\d{1,2}日(?:の)?\s*深夜\s*\d{1,2}時(?:[0-5]?\d分)?\s*より)/iu.exec(
        text,
      );
    const hasReleaseHeading =
      releaseClock &&
      /予約受付開始時間/u.test(
        text.slice(Math.max(0, releaseClock.index - 60), releaseClock.index),
      );
    return {
      bookingWindowLabel: merchantMonth[0].trim(),
      ...(hasReleaseHeading ? { releaseNote: releaseClock[1].trim() } : releaseNote),
    };
  }
  const day = /(?<!\d)(\d{1,3})\s*日前\s*(?:から|より)(?:\s*(?:予約|受付))?/u.exec(text);
  if (day && bookingContext(day.index, day[0].length)) {
    const advanceDays = Number(day[1]);
    if (advanceDays > 0 && advanceDays <= 365)
      return { advanceDays, bookingWindowLabel: day[0].trim(), ...releaseNote };
  }
  const month =
    /(?<!\d)(\d{1,2})\s*(?:か月|ヶ月|ケ月|ヵ月|カ月)\s*前\s*(?:から|より)(?:\s*(?:予約|受付))?/u.exec(
      text,
    );
  if (month && bookingContext(month.index, month[0].length))
    return { bookingWindowLabel: month[0].trim(), ...releaseNote };
  const english = /\b(\d{1,3})\s*days?\s+in\s+advance\b/iu.exec(text);
  if (english && bookingContext(english.index, english[0].length)) {
    const advanceDays = Number(english[1]);
    if (advanceDays > 0 && advanceDays <= 365)
      return {
        advanceDays,
        bookingWindowLabel: english[0].trim(),
        ...releaseNote,
      };
  }
  const englishMonth =
    /\b(?:up to\s+)?(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?\s+in\s+advance\b/iu.exec(
      text,
    );
  if (englishMonth && bookingContext(englishMonth.index, englishMonth[0].length))
    return { bookingWindowLabel: englishMonth[0].trim(), ...releaseNote };
  return releaseNote;
}

export interface TableCheckBookingEvidence extends SearchEvidence {
  readonly booking: {
    readonly name: string;
    readonly address?: string;
    readonly postalCode?: string;
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
export function canonicalTableCheckBookingUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      ['tablecheck.com', 'www.tablecheck.com'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      (/^\/(?:[a-z]{2}\/)?[a-z0-9-]{3,120}\/reserve\/landing\/?$/u.test(url.pathname) ||
        /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?shops\/[a-z0-9-]{3,120}\/reserve\/?$/iu.test(url.pathname))
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
  return typeof value === 'string' && canonicalTableCheckBookingUrl(value) === value;
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
        new URL(value).pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?\//iu, '/').replace(/\/$/u, '');
      await response.body?.cancel();
      // One language redirect on the fixed provider, preserving the exact shop.
      // A second redirect, another shop, or another host supplies no evidence.
      if (!next || next === target || merchantPath(next) !== merchantPath(target))
        return { kind: 'invalid_source' };
      target = next;
      response = await fetcher(target, request);
    }
    if ([401, 403, 429].includes(response.status)) {
      await response.body?.cancel();
      return { kind: 'blocked' };
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      await response.body?.cancel();
      return { kind: 'unavailable' };
    }
    const html = await readBoundedText(response, 1_048_576);
    if (/cf-chl-|cf_chl_|<title[^>]*>\s*Just a moment/iu.test(html)) return { kind: 'blocked' };
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
  if (!title || !/\s[-–]\sTableCheck(?:\s*\(テーブルチェック\))?\s*$/iu.test(decode(title).trim()))
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
    if (!heading || decode(heading).trim() !== name || !policy) return undefined;
    const policyText = decode(policy.replace(/<[^>]*>/gu, ' ')).replace(/\s+/gu, ' ');
    const timing = explicitReservationTiming(policyText);
    // A working booking form need not publish a booking window. Keep the
    // branch address separately from policy so timing never gates the URL.
    const addressRow =
      /class=["'][^"']*resreview-sidebar-content[^"']*["'][^>]*>\s*〒(\d{3}-\d{4})\s*([^<]{8,220})<\/div>/iu.exec(
        html,
      );
    const address = addressRow?.[2];
    // Keep the postcode attached to this branch address, never a footer or
    // policy mention. Short Japanese street numbers need both for identity.
    const postalCode = addressRow?.[1].replace('-', '');
    const officialWebsiteHost = [...policy.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)]
      .flatMap((match) => {
        const label = decode(match[2].replace(/<[^>]*>/gu, ' ')).trim();
        if (
          !/(?:official\s*(?:website|site)|公式(?:サイト|ホームページ|hp)|ホームページ)/iu.test(
            label,
          )
        )
          return [];
        const href = /\bhref\s*=\s*(["'])(https:\/\/[^"']+)\1/iu.exec(match[1])?.[2];
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
      .find((host) => host !== 'tablecheck.com' && host !== 'www.tablecheck.com');
    if (!officialWebsiteHost && !address) return undefined;
    return {
      url: sourceUrl,
      title: name,
      content: `${name} ${address ? decode(address).trim() : ''}\nBooking page: ${sourceUrl}\n${policyText.slice(0, 4000)}`,
      booking: {
        name,
        ...(address ? { address: decode(address).trim() } : {}),
        ...(postalCode ? { postalCode } : {}),
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
  if (timingIndex < 0 || addressIndex < 0 || timingIndex - addressIndex > 2000 || name.length < 3)
    return undefined;
  const address = /【(?:Address|住所)】(?:<[^>]*>|\s){0,6}([^<]{8,220})<br\b/iu.exec(
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
      ...(timing.advanceDays === undefined ? {} : { advanceDays: timing.advanceDays }),
      ...(timing.releaseNote ? { releaseNote: timing.releaseNote } : {}),
    },
  };
}

function decode(value: string): string {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|quot|apos|nbsp);/giu, (raw, entity: string) => {
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
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : raw;
  });
}

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

export type ReservationMode = 'reservable' | 'reservation_required' | 'not_reservable';

/**
 * The dine-in reservation rule a source states explicitly: one mode, `conflict` when its dine-in
 * statements disagree, or undefined when it states none. A takeaway or delivery statement is a
 * different service and is set aside up to the end of its sentence or parenthesis, across any
 * quoted item names (「予約不可 ※テイクアウトの「弁当」のみ電話予約可」 is not_reservable).
 */
export function explicitReservationMode(text: string): ReservationMode | 'conflict' | undefined {
  const dineIn = text
    .normalize('NFKC')
    .replace(
      /(?:テイクアウト|持ち帰り|持帰り|デリバリー|出前|take[\s-]?out|take[\s-]?away|to[\s-]?go|delivery)[\s\S]*?(?=[。\n※);；]|\.\s|$)/giu,
      ' ',
    );
  // A refusal is taken out before the positive and required rules are read, so "not reservable"
  // or "No reservations accepted" is never also read as an acceptance.
  const refusal =
    /予約不可|予約(?:は|を)?(?:受け付けて|受付して)?(?:おりません|いません)|予約できません|予約を?お断り|no reservations?(?: (?:are |is )?(?:accepted|taken|available))?|reservations? (?:are |is )?not (?:accepted|available|possible|taken)|not reservable/giu;
  const rest = dineIn.replace(refusal, ' ').replace(/予約可否/gu, ' ');
  const modes = new Set<ReservationMode>();
  if (dineIn.search(refusal) >= 0) modes.add('not_reservable');
  if (
    /完全予約制|予約必須|要予約|予約制|reservations? (?:are |is )?required|(?:by )?reservations? only/iu.test(
      rest,
    )
  )
    modes.add('reservation_required');
  if (
    /予約可|予約(?:を)?(?:承|受け付け)(?:ります|ております|ています)|reservations? (?:are |is )?(?:accepted|available|possible)|reservable/iu.test(
      rest,
    )
  )
    modes.add('reservable');
  return modes.size > 1 ? 'conflict' : [...modes][0];
}
