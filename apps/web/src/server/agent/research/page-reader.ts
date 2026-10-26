// Reading a Tabelog listing page. Tabelog often refuses requests from Cloudflare, so a reader can
// go through Firecrawl or Cloudflare Browser Rendering; either way only the same public main
// listing is accepted, and a failed or geo-less read falls back to a direct read.
import { isTabelogRestaurantListing } from './instructions.ts';
import {
  isTabelogAccessChallenge,
  parseTabelogListing,
  readTabelogListingResult,
  type TabelogReadResult,
} from './tabelog-listing.ts';
import { logProviderFailure, readBoundedText } from './web-search.ts';

/** Narrow adapter contract for Cloudflare Browser Run's native binding. */
export interface BrowserContentBinding {
  quickAction(
    action: 'content',
    options: {
      url: string;
      gotoOptions: { waitUntil: 'domcontentloaded'; timeout: number };
      rejectResourceTypes: string[];
      allowRequestPattern: string[];
    },
  ): Promise<Response>;
}

export type RestaurantSourceReader = (
  url: string,
  signal: AbortSignal,
) => Promise<TabelogReadResult>;

/** Keep inexpensive successful reads; try the browser once only for source-access failures. */
export function createRestaurantSourceReader(
  browser: BrowserContentBinding,
  fetcher: typeof fetch = fetch,
): RestaurantSourceReader {
  const render = createBrowserRestaurantReader(browser);
  return async (url, signal) => {
    const direct = await readTabelogListingResult(url, fetcher, signal);
    if (direct.kind === 'read' || direct.kind === 'invalid_source' || signal.aborted) return direct;
    const rendered = await render(url, signal);
    // A failed secondary transport must not conceal an observed access refusal.
    if (direct.kind === 'blocked' && rendered.kind === 'unavailable') return direct;
    return rendered;
  };
}

/** Fixed public source only. No credentials, cookies, arbitrary URLs or challenge solver. */
export function createBrowserRestaurantReader(
  browser: BrowserContentBinding,
): RestaurantSourceReader {
  return async (url, signal) => {
    if (!isTabelogRestaurantListing(url)) return { kind: 'invalid_source' };
    const target = new URL(url);
    target.search = '';
    target.hash = '';
    try {
      signal.throwIfAborted();
      const response = await browser.quickAction('content', {
        url: target.href,
        gotoOptions: { waitUntil: 'domcontentloaded', timeout: 12000 },
        rejectResourceTypes: ['image', 'media', 'font', 'websocket'],
        allowRequestPattern: ['^https://tabelog\\.com/'],
      });
      if (!response.ok || signal.aborted) {
        await response.body?.cancel();
        return {
          kind: [401, 403, 429].includes(response.status) ? 'blocked' : 'unavailable',
        };
      }
      const payload: unknown = JSON.parse(await readBoundedText(response, 2_097_152));
      signal.throwIfAborted();
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('success' in payload) ||
        payload.success !== true ||
        !('result' in payload) ||
        typeof payload.result !== 'string'
      )
        return { kind: 'unavailable' };
      const html = payload.result;
      if (isTabelogAccessChallenge(html)) return { kind: 'blocked' };
      const evidence = parseTabelogListing(html, target.href);
      if (evidence) return { kind: 'read', evidence };
      return { kind: 'invalid_source' };
    } catch {
      return { kind: 'unavailable' };
    }
  };
}

/** Read only public Tabelog main listings; never send owner/model credentials to a source. */
export function createFirecrawlRestaurantReader(
  options: {
    apiKey?: string;
    fetch?: typeof fetch;
  } = {},
): RestaurantSourceReader {
  const fetcher = options.fetch ?? fetch;
  return async (url, parentSignal) => {
    if (!isTabelogRestaurantListing(url)) return { kind: 'invalid_source' };
    const target = new URL(url);
    target.search = '';
    target.hash = '';
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(20_000)]);
    try {
      signal.throwIfAborted();
      const response = await fetcher('https://api.firecrawl.dev/v2/scrape', {
        method: 'POST',
        redirect: 'manual',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          url: target.href,
          formats: ['rawHtml'],
          onlyMainContent: false,
          maxAge: 0,
          timeout: 15_000,
          proxy: 'basic',
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        // This is a reader-service failure/quota, not proof that Tabelog refused access.
        logProviderFailure('firecrawl', 'unavailable', response.status);
        return { kind: 'unavailable' };
      }
      const payload: unknown = JSON.parse(await readBoundedText(response, 2_097_152));
      signal.throwIfAborted();
      if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
        logProviderFailure('firecrawl', 'unavailable', response.status);
        return { kind: 'unavailable' };
      }
      const { rawHtml, metadata } = payload.data;
      const sourceStatus = isRecord(metadata) ? Number(metadata.statusCode) : undefined;
      const result = ((): TabelogReadResult => {
        if (!isRecord(metadata)) return { kind: 'invalid_source' };
        if ([401, 403, 429].includes(Number(metadata.statusCode))) return { kind: 'blocked' };
        if (metadata.statusCode !== 200 || typeof rawHtml !== 'string')
          return { kind: 'unavailable' };
        // The requested sourceURL alone is insufficient: validate the resulting page URL too.
        if (!sameListing(metadata.url, target) || !sameListing(metadata.sourceURL, target))
          return { kind: 'invalid_source' };
        if (isTabelogAccessChallenge(rawHtml)) return { kind: 'blocked' };
        const evidence = parseTabelogListing(rawHtml, target.href);
        return evidence ? { kind: 'read', evidence } : { kind: 'invalid_source' };
      })();
      if (result.kind !== 'read')
        logProviderFailure('firecrawl', result.kind, response.status, sourceStatus);
      return result;
    } catch {
      logProviderFailure('firecrawl', signal.aborted ? 'timeout' : 'transport');
      return { kind: 'unavailable' };
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sameListing(value: unknown, target: URL): boolean {
  if (!isTabelogRestaurantListing(value)) return false;
  const actual = new URL(value as string);
  return actual.pathname.replace(/\/$/u, '') === target.pathname.replace(/\/$/u, '');
}

/** Retry only the same validated listing when the primary transport fails or omits geo. */
export function withSameListingFallback(
  primary: RestaurantSourceReader,
  fallback: RestaurantSourceReader,
): RestaurantSourceReader {
  return async (url, signal) => {
    const first = await primary(url, signal);
    if (
      signal.aborted ||
      (first.kind === 'read' &&
        (first.evidence.restaurant?.coordinates || first.evidence.nameBridge))
    )
      return first;
    const second = await fallback(url, signal);
    if (second.kind === 'read') {
      if (first.kind !== 'read' || second.evidence.restaurant?.coordinates) return second;
      return first;
    }
    if (first.kind === 'read') return first;
    if (first.kind === 'blocked' || second.kind === 'blocked') return { kind: 'blocked' };
    return first.kind === 'invalid_source' ? first : second;
  };
}
