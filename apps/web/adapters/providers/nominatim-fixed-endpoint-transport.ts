import { failure } from '../../product/application/result.ts';
import { fetchBoundedJson } from './bounded-json-http.ts';

const endpoint = 'https://nominatim.openstreetmap.org/search';

export function createNominatimFixedEndpointTransport(options: {
  readonly fetch?: typeof fetch;
}) {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async search(request: {
      readonly url: string;
      readonly headers: {
        readonly 'User-Agent': string;
        readonly Referer: string;
      };
    }) {
      if (!validRequestUrl(request.url)) {
        return failure(
          'dependency_failure',
          'Durable location lookup is unavailable.',
        );
      }
      const response = await fetchBoundedJson(
        request.url,
        { method: 'GET', headers: request.headers },
        { fetch: fetchImpl, timeoutMs: 8_000, maximumBytes: 64 * 1024 },
      );
      return response.ok
        ? { ok: true as const, value: response.value }
        : failure(
            'dependency_failure',
            'Durable location lookup is unavailable.',
          );
    },
  };
}

function validRequestUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      `${url.origin}${url.pathname}` !== endpoint ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return false;
    }
    const keys = [...url.searchParams.keys()].sort();
    return (
      keys.join(',') === 'format,limit,q' &&
      url.searchParams.get('format') === 'jsonv2' &&
      url.searchParams.get('limit') === '3' &&
      Boolean(url.searchParams.get('q'))
    );
  } catch {
    return false;
  }
}
