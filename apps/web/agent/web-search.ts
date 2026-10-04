export type SearchEvidence = { url: string; title: string; content: string };
export type SearchOutcome =
  | { kind: 'results'; sources: SearchEvidence[] }
  | {
      kind: 'unavailable';
      reason: 'blocked' | 'provider_failure' | 'invalid_response';
    };

/** Only fixed public search endpoints are fetched; result URLs are evidence, not fetch targets. */
export function createWebSearch(options: {
  apiKey?: string;
  fetch?: typeof fetch;
}) {
  const fetcher = options.fetch ?? fetch;
  return {
    async search(query: string, signal: AbortSignal): Promise<SearchOutcome> {
      if (!query.trim() || query.length > 500)
        return { kind: 'unavailable', reason: 'invalid_response' };
      try {
        if (options.apiKey) {
          const response = await fetcher('https://api.tavily.com/search', {
            method: 'POST',
            redirect: 'manual',
            signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${options.apiKey}`,
            },
            body: JSON.stringify({
              query,
              max_results: 3,
              search_depth: 'basic',
              include_answer: false,
              include_raw_content: false,
            }),
          });
          if (!response.ok)
            return { kind: 'unavailable', reason: 'provider_failure' };
          const result = JSON.parse(await readBoundedText(response, 131_072));
          if (!Array.isArray(result.results))
            return { kind: 'unavailable', reason: 'invalid_response' };
          const sources = result.results
            .flatMap((row: Record<string, unknown>) => {
              if (
                typeof row.url !== 'string' ||
                typeof row.content !== 'string' ||
                !publicHttps(row.url)
              )
                return [];
              return [
                {
                  url: row.url,
                  title:
                    typeof row.title === 'string'
                      ? row.title.slice(0, 300)
                      : '',
                  content: row.content.slice(0, 8000),
                },
              ];
            })
            .slice(0, 3);
          return { kind: 'results', sources };
        }
        if (/[\u3040-\u30ff\u3400-\u9fff]|tabelog/iu.test(query)) {
          const primary = await searchYahooJapan(fetcher, query, signal);
          if (primary.kind === 'results' && primary.sources.length) {
            return primary;
          }
          const fallback = await searchDuckDuckGo(fetcher, query, signal);
          return fallback.kind === 'results' ? fallback : primary;
        }
        return searchDuckDuckGo(fetcher, query, signal);
      } catch {
        return { kind: 'unavailable', reason: 'provider_failure' };
      }
    },
  };
}

async function searchYahooJapan(
  fetcher: typeof fetch,
  query: string,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  try {
    const endpoint = new URL('https://search.yahoo.co.jp/search');
    endpoint.searchParams.set('p', query);
    const response = await fetcher(endpoint.href, {
      redirect: 'manual',
      signal,
      headers: { Accept: 'text/html', 'User-Agent': 'JapanAtlas/1.0' },
    });
    if ([202, 403, 429].includes(response.status))
      return { kind: 'unavailable', reason: 'blocked' };
    if (!response.ok)
      return { kind: 'unavailable', reason: 'provider_failure' };
    return parseYahooJapanHtml(await readBoundedText(response, 262_144));
  } catch {
    return { kind: 'unavailable', reason: 'provider_failure' };
  }
}

async function searchDuckDuckGo(
  fetcher: typeof fetch,
  query: string,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  try {
    const endpoint = new URL('https://html.duckduckgo.com/html');
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('kp', '-1');
    const response = await fetcher(endpoint.href, {
      redirect: 'manual',
      signal,
      headers: { Accept: 'text/html', 'User-Agent': 'JapanAtlas/1.0' },
    });
    if ([202, 403, 429].includes(response.status))
      return { kind: 'unavailable', reason: 'blocked' };
    if (!response.ok)
      return { kind: 'unavailable', reason: 'provider_failure' };
    return parseDuckDuckGoHtml(await readBoundedText(response, 262_144));
  } catch {
    return { kind: 'unavailable', reason: 'provider_failure' };
  }
}

export function parseYahooJapanHtml(html: string): SearchOutcome {
  if (/captcha|challenge-form|ロボットではない/iu.test(html))
    return { kind: 'unavailable', reason: 'blocked' };
  if (/に一致するウェブページは見つかりませんでした/u.test(plainText(html)))
    return { kind: 'results', sources: [] };
  const region = html.split(/<div\b[^>]*id=["']web["'][^>]*>/iu)[1];
  if (!region) return { kind: 'unavailable', reason: 'invalid_response' };
  const sources: SearchEvidence[] = [];
  for (const row of region.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/giu)) {
    const link = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/iu.exec(row[1]);
    const url = link && decodeEntities(attribute(link[1], 'href') ?? '');
    if (
      !url ||
      !link ||
      !publicHttps(url) ||
      new URL(url).hostname.endsWith('yahoo.co.jp')
    )
      continue;
    const title = plainText(link[2]).slice(0, 300);
    const snippet =
      /<div\b[^>]*>([\s\S]*?)<\/div\s*>/iu.exec(row[1])?.[1] ?? '';
    if (title && !sources.some((source) => source.url === url))
      sources.push({
        url,
        title,
        content: `${title}\n${plainText(snippet).slice(0, 8000)}`.trim(),
      });
    if (sources.length === 3) break;
  }
  return sources.length
    ? { kind: 'results', sources }
    : { kind: 'unavailable', reason: 'invalid_response' };
}

export function parseDuckDuckGoHtml(html: string): SearchOutcome {
  if (
    /anomaly-modal|challenge-form|id=["']captcha|name=["']captcha|bots use DuckDuckGo/iu.test(
      html,
    )
  )
    return { kind: 'unavailable', reason: 'blocked' };
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/giu)];
  const sources: SearchEvidence[] = [];
  for (let index = 0; index < links.length; index++) {
    const link = links[index];
    if (!link || !hasClass(link[1] ?? '', 'result__a')) continue;
    const href = attribute(link[1] ?? '', 'href');
    if (!href) continue;
    let url: string;
    try {
      const candidate = new URL(decodeEntities(href), 'https://duckduckgo.com');
      url =
        candidate.hostname === 'duckduckgo.com' && candidate.pathname === '/l/'
          ? (candidate.searchParams.get('uddg') ?? '')
          : candidate.href;
      if (!publicHttps(url) || new URL(url).hostname.endsWith('duckduckgo.com'))
        continue;
    } catch {
      continue;
    }
    const next = links
      .slice(index + 1)
      .find((item) => hasClass(item[1] ?? '', 'result__a'));
    const section = html.slice(
      (link.index ?? 0) + link[0].length,
      next?.index ?? html.length,
    );
    const snippet = [
      ...section.matchAll(/<(a|div|span)\b([^>]*)>([\s\S]*?)<\/\1\s*>/giu),
    ].find((item) => hasClass(item[2] ?? '', 'result__snippet'));
    const title = plainText(link[2] ?? '').slice(0, 300);
    const content = plainText(snippet?.[3] ?? '').slice(0, 8000);
    if (title && !sources.some((source) => source.url === url))
      sources.push({ url, title, content: `${title}\n${content}`.trim() });
    if (sources.length === 3) break;
  }
  if (!sources.length && !/no-results|No results found/iu.test(html))
    return { kind: 'unavailable', reason: 'invalid_response' };
  return { kind: 'results', sources };
}

function attribute(value: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu').exec(value)?.[2];
}
function hasClass(value: string, name: string): boolean {
  return (attribute(value, 'class') ?? '').split(/\s+/u).includes(name);
}
function plainText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
}
function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/giu,
    (whole, entity: string) => {
      if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? whole;
      const point = entity.toLowerCase().startsWith('#x')
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return point > 0 &&
        point <= 0x10ffff &&
        (point < 0xd800 || point > 0xdfff)
        ? String.fromCodePoint(point)
        : whole;
    },
  );
}
function publicHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hostname.includes(':') &&
      !/^\d/u.test(url.hostname) &&
      url.hostname.includes('.') &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid|localhost\.localdomain)$/u.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
export async function readBoundedText(
  response: Response,
  maximum: number,
): Promise<string> {
  if (
    !response.body ||
    Number(response.headers.get('content-length') ?? 0) > maximum
  )
    throw new Error('Invalid provider body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error('Provider response too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
