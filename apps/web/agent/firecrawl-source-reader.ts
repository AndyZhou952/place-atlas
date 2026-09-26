import type { RestaurantSourceReader } from './browser-source-reader.ts';
import { isTabelogRestaurantListing } from './research-instructions.ts';
import {
  isTabelogAccessChallenge,
  parseTabelogListing,
} from './tabelog-listing.ts';
import { readBoundedText } from './web-search.ts';

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
          ...(options.apiKey
            ? { Authorization: `Bearer ${options.apiKey}` }
            : {}),
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
        return { kind: 'unavailable' };
      }
      const payload: unknown = JSON.parse(
        await readBoundedText(response, 2_097_152),
      );
      signal.throwIfAborted();
      if (
        !isRecord(payload) ||
        payload.success !== true ||
        !isRecord(payload.data)
      )
        return { kind: 'unavailable' };
      const { rawHtml, metadata } = payload.data;
      if (!isRecord(metadata)) return { kind: 'invalid_source' };
      if ([401, 403, 429].includes(Number(metadata.statusCode)))
        return { kind: 'blocked' };
      if (metadata.statusCode !== 200 || typeof rawHtml !== 'string')
        return { kind: 'unavailable' };
      // The requested sourceURL alone is insufficient: validate the resulting page URL too.
      if (
        !sameListing(metadata.url, target) ||
        !sameListing(metadata.sourceURL, target)
      )
        return { kind: 'invalid_source' };
      if (isTabelogAccessChallenge(rawHtml)) return { kind: 'blocked' };
      const evidence = parseTabelogListing(rawHtml, target.href);
      return evidence ? { kind: 'read', evidence } : { kind: 'invalid_source' };
    } catch {
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
  return (
    actual.pathname.replace(/\/$/u, '') === target.pathname.replace(/\/$/u, '')
  );
}
