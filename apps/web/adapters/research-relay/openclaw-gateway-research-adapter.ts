import type { HardenedResearchTransport } from './hardened-research-transport.ts';
import type { OpenClawUrlSearchPort } from './research-relay-handler.ts';
import type { ResearchSourcePolicy } from './research-source-policy.ts';

const maximumGatewayResponseBytes = 96 * 1024;
const maximumFetchedTextBytes = 64 * 1024;
const maximumGatewayTokenCharacters = 4_096;

interface GatewayInvoker {
  invoke(
    tool: 'web_search' | 'web_fetch',
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export function createOpenClawGatewayResearchAdapters(dependencies: {
  readonly endpoint: string;
  readonly token: string;
  readonly sourcePolicy: ResearchSourcePolicy;
  readonly fetch?: typeof fetch;
}): {
  readonly searchTool: OpenClawUrlSearchPort;
  readonly transport: HardenedResearchTransport;
} {
  const gateway = createGatewayInvoker(dependencies);
  return {
    searchTool: {
      async invoke(input) {
        if (
          input.toolId !== 'openclaw.web_search' ||
          input.toolVersion !== 'v1' ||
          input.arguments.maxResults !== 3 ||
          input.arguments.output !== 'url_candidates_only' ||
          input.signal.aborted ||
          Date.now() >= input.deadlineAtMs
        ) {
          throw new TypeError('OpenClaw search request is invalid.');
        }
        const output = await gateway.invoke(
          'web_search',
          {
            query: `${input.arguments.query} site:tabelog.com`,
            count: 3,
          },
          input.signal,
        );
        const urls = readSearchUrls(output, dependencies.sourcePolicy);
        if (!urls) throw new TypeError('OpenClaw search response is invalid.');
        return { urls };
      },
    },
    transport: {
      async get(value, limits) {
        const canonicalUrl =
          dependencies.sourcePolicy.authorizeCandidate(value);
        if (
          !canonicalUrl ||
          limits.signal?.aborted ||
          Date.now() >= limits.deadlineAtMs
        ) {
          return failed('security_blocked');
        }
        const controller = new AbortController();
        const abort = () => controller.abort(limits.signal?.reason);
        limits.signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(
          () =>
            controller.abort(
              new DOMException('Web fetch deadline exceeded.', 'TimeoutError'),
            ),
          Math.max(
            0,
            Math.min(limits.timeoutMs, limits.deadlineAtMs - Date.now()),
          ),
        );
        try {
          const output = await gateway.invoke(
            'web_fetch',
            { url: canonicalUrl, extractMode: 'text', maxChars: 64_000 },
            controller.signal,
          );
          const fetched = readFetchOutput(output, dependencies.sourcePolicy);
          if (!fetched || fetched.requestedUrl !== canonicalUrl) {
            return failed('malformed');
          }
          // The Gateway result does not expose a trustworthy redirect count.
          // Fail closed on every redirect instead of under-reporting usage.
          if (
            fetched.finalUrl !== canonicalUrl ||
            !dependencies.sourcePolicy.authorizeRedirect(
              canonicalUrl,
              fetched.finalUrl,
            )
          ) {
            return failed('security_blocked');
          }
          return {
            status: 'ok',
            finalUrl: fetched.finalUrl,
            body: fetched.text,
            requestCount: 1,
            redirectsFollowed: 0,
          };
        } catch {
          return failed(
            controller.signal.aborted || Date.now() >= limits.deadlineAtMs
              ? 'deadline'
              : 'unavailable',
          );
        } finally {
          clearTimeout(timeout);
          limits.signal?.removeEventListener('abort', abort);
          if (!controller.signal.aborted) {
            controller.abort(
              new DOMException('Web fetch completed.', 'AbortError'),
            );
          }
        }
      },
    },
  };
}

function createGatewayInvoker(dependencies: {
  readonly endpoint: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}): GatewayInvoker {
  const endpoint = validateLoopbackGatewayEndpoint(dependencies.endpoint);
  if (
    !endpoint ||
    typeof dependencies.token !== 'string' ||
    dependencies.token.length < 1 ||
    dependencies.token.length > maximumGatewayTokenCharacters ||
    hasAsciiControlCharacter(dependencies.token)
  ) {
    throw new TypeError('OpenClaw Gateway configuration is invalid.');
  }
  const fetchImpl = dependencies.fetch ?? fetch;
  return {
    async invoke(tool, args, signal) {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${dependencies.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tool, args }),
        signal,
      });
      if (!response.ok || response.status !== 200) {
        throw new TypeError('OpenClaw Gateway request failed.');
      }
      const envelope = await readBoundedJson(
        response,
        maximumGatewayResponseBytes,
      );
      if (
        !isRecord(envelope) ||
        envelope.ok !== true ||
        !Object.hasOwn(envelope, 'result')
      ) {
        throw new TypeError('OpenClaw Gateway response is invalid.');
      }
      return readToolDetails(envelope.result);
    },
  };
}

function validateLoopbackGatewayEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', '::1'].includes(hostname) ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.pathname !== '/tools/invoke'
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function readToolDetails(value: unknown): unknown {
  if (!isRecord(value) || !Object.hasOwn(value, 'details')) {
    throw new TypeError('OpenClaw tool result has no structured details.');
  }
  return value.details;
}

function readSearchUrls(
  value: unknown,
  policy: ResearchSourcePolicy,
): readonly string[] | undefined {
  if (!isRecord(value)) return undefined;
  const candidates: unknown[] = [];
  // OpenClaw 2026.7 returns provider + results directly. The tagged result
  // shape remains accepted for compatibility with older Gateway fixtures.
  if (value.provider === 'duckduckgo' && Array.isArray(value.results)) {
    candidates.push(...value.results.map((result) => readUrl(result)));
  } else if (value.kind === 'results') {
    if (!Array.isArray(value.results)) return undefined;
    candidates.push(...value.results.map((result) => readUrl(result)));
  } else if (value.kind === 'answer') {
    if (!Array.isArray(value.citations)) return undefined;
    candidates.push(...value.citations.map((citation) => readUrl(citation)));
  } else if (value.kind === 'error') {
    throw new TypeError('OpenClaw search provider is unavailable.');
  } else {
    return undefined;
  }
  const urls: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const canonical = policy.authorizeCandidate(candidate);
    if (canonical && !urls.includes(canonical)) urls.push(canonical);
    if (urls.length === 3) break;
  }
  return urls;
}

function readFetchOutput(
  value: unknown,
  policy: ResearchSourcePolicy,
):
  | {
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly text: string;
    }
  | undefined {
  if (
    !isRecord(value) ||
    typeof value.url !== 'string' ||
    typeof value.finalUrl !== 'string' ||
    typeof value.status !== 'number' ||
    value.status < 200 ||
    value.status >= 300 ||
    value.extractMode !== 'text' ||
    typeof value.text !== 'string' ||
    new TextEncoder().encode(value.text).byteLength > maximumFetchedTextBytes
  ) {
    return undefined;
  }
  const requestedUrl = policy.canonicalize(value.url);
  const finalUrl = policy.canonicalize(value.finalUrl);
  return requestedUrl && finalUrl
    ? { requestedUrl, finalUrl, text: value.text }
    : undefined;
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new TypeError('OpenClaw Gateway response is not JSON.');
  }
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new TypeError('OpenClaw Gateway response is too large.');
  }
  if (!response.body)
    throw new TypeError('OpenClaw Gateway response is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new TypeError('OpenClaw Gateway response is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function readUrl(value: unknown): string | undefined {
  return isRecord(value) && typeof value.url === 'string'
    ? value.url
    : undefined;
}

function failed(
  reason: 'security_blocked' | 'malformed' | 'unavailable' | 'deadline',
) {
  return {
    status: 'failed' as const,
    reason,
    requestCount: 0,
    redirectsFollowed: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
