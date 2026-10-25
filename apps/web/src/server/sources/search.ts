import { readBoundedText } from '../http.ts';

export interface SearchResult {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

/**
 * Web search through fixed endpoints only. Result URLs are evidence, never fetched here.
 * With a Tavily key the API is used; otherwise Yahoo! JAPAN, then DuckDuckGo HTML.
 */
export async function webSearch(
  query: string,
  options: { readonly apiKey?: string; readonly fetch?: typeof fetch } = {},
): Promise<SearchResult[]> {
  const fetcher = options.fetch ?? fetch;
  if (options.apiKey) {
    const response = await fetcher('https://api.tavily.com/search', {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'basic' }),
    });
    if (!response.ok) throw new Error(`Search returned HTTP ${response.status}`);
    const body = JSON.parse(await readBoundedText(response, 262_144));
    return (Array.isArray(body.results) ? body.results : []).flatMap(
      (row: Record<string, unknown>) =>
        typeof row.url === 'string'
          ? [
              {
                url: row.url,
                title: String(row.title ?? ''),
                snippet: String(row.content ?? '').slice(0, 2000),
              },
            ]
          : [],
    );
  }
  const engines = [
    {
      url: `https://search.yahoo.co.jp/search?p=${encodeURIComponent(query)}`,
      parse: parseYahooJapan,
    },
    {
      url: `https://html.duckduckgo.com/html?q=${encodeURIComponent(query)}&kp=-1`,
      parse: parseDuckDuckGo,
    },
  ];
  for (const engine of engines) {
    try {
      const response = await fetcher(engine.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: { accept: 'text/html', 'user-agent': 'JapanAtlas/1.0' },
      });
      if (!response.ok) continue;
      const results = engine.parse(await readBoundedText(response, 1_048_576));
      if (results.length) return results;
    } catch {
      // Try the next engine; a failure is not evidence of absence.
    }
  }
  return [];
}

const plain = (html: string) =>
  decodeEntities(html.replace(/<[^>]*>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
const attribute = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu').exec(tag)?.[2];

export function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: ' ',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (whole, entity: string) => {
    if (!entity.startsWith('#')) return named[entity.toLowerCase()] ?? whole;
    const point =
      entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

export function parseYahooJapan(html: string): SearchResult[] {
  const region = html.split(/<div\b[^>]*id=["']web["'][^>]*>/iu)[1] ?? '';
  return [...region.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/giu)].flatMap(([, row]) => {
    const link = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/iu.exec(row);
    const url = link && decodeEntities(attribute(link[1], 'href') ?? '');
    if (!link || !url?.startsWith('https://') || url.includes('yahoo.co.jp')) return [];
    return [
      {
        url,
        title: plain(link[2]),
        snippet: plain(/<div\b[^>]*>([\s\S]*?)<\/div\s*>/iu.exec(row)?.[1] ?? ''),
      },
    ];
  });
}

export function parseDuckDuckGo(html: string): SearchResult[] {
  return [
    ...html.matchAll(/<a\b([^>]*class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a\s*>/giu),
  ].flatMap(([, tag, title]) => {
    try {
      const href = new URL(decodeEntities(attribute(tag, 'href') ?? ''), 'https://duckduckgo.com');
      const url = href.pathname === '/l/' ? (href.searchParams.get('uddg') ?? '') : href.href;
      return url.startsWith('https://') && !url.includes('duckduckgo.com')
        ? [{ url, title: plain(title), snippet: '' }]
        : [];
    } catch {
      return [];
    }
  });
}
