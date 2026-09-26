import { isTabelogRestaurantListing } from './research-instructions.ts';
import {
  parseTabelogListing,
  readTabelogListingResult,
  type TabelogReadResult,
} from './tabelog-listing.ts';
import { readBoundedText } from './web-search.ts';

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
    if (
      direct.kind === 'read' ||
      direct.kind === 'invalid_source' ||
      signal.aborted
    )
      return direct;
    const rendered = await render(url, signal);
    // A failed secondary transport must not conceal an observed access refusal.
    if (direct.kind === 'blocked' && rendered.kind === 'unavailable')
      return direct;
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
          kind: [401, 403, 429].includes(response.status)
            ? 'blocked'
            : 'unavailable',
        };
      }
      const payload: unknown = JSON.parse(
        await readBoundedText(response, 2_097_152),
      );
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
      const evidence = parseTabelogListing(html, target.href);
      if (evidence) return { kind: 'read', evidence };
      if (
        /現在アクセスが集中|<title>\s*Just a moment|cf-chl-|cf_chl_/iu.test(
          html,
        )
      )
        return { kind: 'blocked' };
      return { kind: 'invalid_source' };
    } catch {
      return { kind: 'unavailable' };
    }
  };
}
