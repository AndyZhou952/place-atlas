import ipaddr from 'ipaddr.js';

import { publicUnicastAddressClassifier } from '../providers/public-unicast-address-classifier.ts';
import type { ResearchSourcePolicy } from './research-source-policy.ts';

export interface ResearchDnsPort {
  resolve(
    hostname: string,
    input: { readonly signal: AbortSignal; readonly deadlineAtMs: number },
  ): Promise<unknown>;
}

export interface PinnedHttpsConnectorPort {
  request(input: {
    readonly url: string;
    readonly pinnedIp: string;
    readonly tlsServerName: string;
    readonly hostHeader: string;
    readonly timeoutMs: number;
    readonly followRedirects: false;
    readonly retry: false;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
}

export interface HardenedResearchTransport {
  get(
    url: string,
    limits: {
      readonly timeoutMs: number;
      readonly maxRedirects: number;
      readonly deadlineAtMs: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<
    | {
        readonly status: 'ok';
        readonly finalUrl: string;
        readonly body: string;
        readonly requestCount: number;
        readonly redirectsFollowed: number;
      }
    | {
        readonly status: 'failed';
        readonly reason:
          | 'no_evidence'
          | 'page_blocked'
          | 'rate_limited'
          | 'unavailable'
          | 'security_blocked'
          | 'conflict'
          | 'malformed'
          | 'deadline';
        readonly requestCount: number;
        readonly redirectsFollowed: number;
      }
  >;
}

const redirectStatuses = new Set([300, 301, 302, 303, 307, 308]);
const maxHeaderBytes = 32_768;
const maxHeaderCount = 100;
const maxResponseBytes = 1_000_000;
const metadataHostnames = new Set([
  'instance-data.ec2.internal',
  'metadata.azure.internal',
  'metadata.google.internal',
]);

export function createHardenedResearchTransport(dependencies: {
  readonly dns: ResearchDnsPort;
  readonly connector: PinnedHttpsConnectorPort;
  readonly sourcePolicy: ResearchSourcePolicy;
  readonly now?: () => number;
}): HardenedResearchTransport {
  const now = dependencies.now ?? Date.now;
  return {
    async get(url, limits) {
      let currentUrl = url;
      let previousUrl: string | undefined;
      let redirectsFollowed = 0;
      let requestCount = 0;
      const failed = (
        reason:
          | 'no_evidence'
          | 'page_blocked'
          | 'rate_limited'
          | 'unavailable'
          | 'security_blocked'
          | 'conflict'
          | 'malformed'
          | 'deadline',
      ) => ({
        status: 'failed' as const,
        reason,
        requestCount,
        redirectsFollowed,
      });
      if (!validLimits(limits)) return failed('security_blocked');
      const deadline = createDeadlineSignal(
        limits.signal,
        limits.deadlineAtMs,
        now,
      );

      try {
        while (true) {
          const remainingMs = limits.deadlineAtMs - now();
          if (remainingMs <= 0 || deadline.signal.aborted) {
            return failed('deadline');
          }
          const policyUrl = previousUrl
            ? dependencies.sourcePolicy.authorizeRedirect(
                previousUrl,
                currentUrl,
              )
            : dependencies.sourcePolicy.authorizeCandidate(currentUrl);
          if (!policyUrl) return failed('security_blocked');
          const parsed = validateHttpsUrl(policyUrl);
          if (!parsed) return failed('security_blocked');
          const resolved = await raceWithAbort(
            dependencies.dns.resolve(parsed.hostname, {
              signal: deadline.signal,
              deadlineAtMs: limits.deadlineAtMs,
            }),
            deadline.signal,
          );
          const addresses = validateDnsAnswer(resolved);
          if (!addresses) return failed('security_blocked');
          const connectorRemainingMs = limits.deadlineAtMs - now();
          if (connectorRemainingMs <= 0 || deadline.signal.aborted) {
            return failed('deadline');
          }
          const pinnedIp = addresses[0];
          if (!pinnedIp) return failed('security_blocked');
          const rawResponse = await dependencies.connector.request({
            url: parsed.toString(),
            pinnedIp,
            tlsServerName: parsed.hostname,
            hostHeader: parsed.hostname,
            timeoutMs: Math.min(limits.timeoutMs, connectorRemainingMs),
            followRedirects: false,
            retry: false,
            signal: deadline.signal,
          });
          requestCount += 1;
          const response = validateConnectorResponse(rawResponse);
          if (now() >= limits.deadlineAtMs || deadline.signal.aborted) {
            return failed('deadline');
          }
          if (!response) return failed('malformed');
          const connectedIp = normalizePublicIp(response.connectedIp);
          if (
            !connectedIp ||
            connectedIp !== pinnedIp ||
            !addresses.includes(connectedIp)
          ) {
            return failed('security_blocked');
          }
          if (response.status >= 200 && response.status < 300) {
            if (!validDocumentHeaders(response.headers)) {
              return failed('malformed');
            }
            const body = await readBody(
              response.body,
              now,
              limits.deadlineAtMs,
              deadline.signal,
            );
            if (body === undefined) {
              return failed(
                deadline.signal.aborted || now() >= limits.deadlineAtMs
                  ? 'deadline'
                  : 'malformed',
              );
            }
            return {
              status: 'ok',
              finalUrl: parsed.toString(),
              body,
              requestCount,
              redirectsFollowed,
            };
          }
          if (!redirectStatuses.has(response.status)) {
            return failed(reasonForHttpStatus(response.status));
          }
          if (
            !validContentEncoding(response.headers) ||
            (await consumeBody(
              response.body,
              now,
              limits.deadlineAtMs,
              deadline.signal,
            )) === undefined
          ) {
            return failed(
              deadline.signal.aborted || now() >= limits.deadlineAtMs
                ? 'deadline'
                : 'malformed',
            );
          }
          const location = response.headers.location;
          if (
            typeof location !== 'string' ||
            location.length === 0 ||
            redirectsFollowed >= limits.maxRedirects
          ) {
            return failed(
              redirectsFollowed >= limits.maxRedirects
                ? 'security_blocked'
                : 'malformed',
            );
          }
          previousUrl = parsed.toString();
          currentUrl = new URL(location, parsed).toString();
          redirectsFollowed += 1;
        }
      } catch {
        return failed(
          deadline.signal.aborted || now() >= limits.deadlineAtMs
            ? 'deadline'
            : 'unavailable',
        );
      } finally {
        deadline.dispose();
      }
    },
  };
}

function raceWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException('Request aborted.', 'AbortError'),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(
        signal.reason ?? new DOMException('Request aborted.', 'AbortError'),
      );
    };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function reasonForHttpStatus(
  status: number,
):
  | 'no_evidence'
  | 'page_blocked'
  | 'rate_limited'
  | 'unavailable'
  | 'conflict'
  | 'malformed' {
  if (status === 404 || status === 410) return 'no_evidence';
  if (status === 401 || status === 403 || status === 451) {
    return 'page_blocked';
  }
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'malformed';
}

function validLimits(limits: {
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly deadlineAtMs: number;
}): boolean {
  return (
    Number.isInteger(limits.timeoutMs) &&
    limits.timeoutMs > 0 &&
    limits.timeoutMs <= 15_000 &&
    Number.isInteger(limits.maxRedirects) &&
    limits.maxRedirects >= 0 &&
    limits.maxRedirects <= 3 &&
    Number.isSafeInteger(limits.deadlineAtMs) &&
    limits.deadlineAtMs > 0
  );
}

function validateHttpsUrl(value: string): URL | undefined {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  const hostname = parsed.hostname.toLowerCase();
  const unbracketedHostname = hostname.replace(/^\[|\]$/gu, '');
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.port !== '' && parsed.port !== '443') ||
    parsed.hash !== '' ||
    hostname === '' ||
    ipaddr.isValid(unbracketedHostname) ||
    isMetadataHostname(hostname)
  ) {
    return undefined;
  }
  return parsed;
}

function isMetadataHostname(hostname: string): boolean {
  return (
    hostname === 'metadata' ||
    hostname.startsWith('metadata.') ||
    metadataHostnames.has(hostname)
  );
}

function validateDnsAnswer(value: unknown): readonly string[] | undefined {
  if (!hasExactKeys(value, ['a', 'aaaa'])) return undefined;
  const a = validateDnsFamily(value.a, 'ipv4');
  const aaaa = validateDnsFamily(value.aaaa, 'ipv6');
  if (!a || !aaaa) return undefined;
  const addresses = [...a, ...aaaa];
  if (addresses.length === 0) return undefined;
  const normalized = addresses.map(normalizePublicIp);
  if (normalized.some((address) => address === undefined)) return undefined;
  return [...new Set(normalized as string[])].sort();
}

function validateDnsFamily(
  value: unknown,
  kind: 'ipv4' | 'ipv6',
): readonly string[] | undefined {
  if (hasExactKeys(value, ['status']) && value.status === 'nodata') return [];
  if (
    !hasExactKeys(value, ['status', 'addresses']) ||
    value.status !== 'ok' ||
    !Array.isArray(value.addresses) ||
    value.addresses.length === 0
  ) {
    return undefined;
  }
  for (const address of value.addresses) {
    if (typeof address !== 'string') return undefined;
    try {
      const parsed = ipaddr.parse(address);
      if (
        parsed.kind() !== kind ||
        (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress())
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  return value.addresses as string[];
}

function normalizePublicIp(value: unknown): string | undefined {
  return typeof value === 'string'
    ? publicUnicastAddressClassifier.normalizePublicUnicast(value)
    : undefined;
}

function validateConnectorResponse(value: unknown):
  | {
      readonly status: number;
      readonly headers: Readonly<Record<string, unknown>>;
      readonly connectedIp: string;
      readonly body: AsyncIterable<Uint8Array>;
    }
  | undefined {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.status) ||
    (value.status as number) < 100 ||
    (value.status as number) > 599 ||
    !validateHeaders(value.headers) ||
    typeof value.connectedIp !== 'string' ||
    !isAsyncByteStream(value.body)
  ) {
    return undefined;
  }
  return value as {
    readonly status: number;
    readonly headers: Readonly<Record<string, unknown>>;
    readonly connectedIp: string;
    readonly body: AsyncIterable<Uint8Array>;
  };
}

function validateHeaders(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > maxHeaderCount) return false;
  let bytes = 0;
  for (const [name, headerValue] of entries) {
    if (
      name !== name.toLowerCase() ||
      !/^[a-z0-9-]+$/u.test(name) ||
      typeof headerValue !== 'string' ||
      /[\r\n]/u.test(headerValue)
    ) {
      return false;
    }
    bytes += new TextEncoder().encode(`${name}:${headerValue}`).byteLength;
    if (bytes > maxHeaderBytes) return false;
  }
  return true;
}

function validDocumentHeaders(
  headers: Readonly<Record<string, unknown>>,
): boolean {
  if (!validContentEncoding(headers)) return false;
  const contentType = headers['content-type'];
  if (typeof contentType !== 'string') return false;
  const [mediaType, ...parameters] = contentType
    .toLowerCase()
    .split(';')
    .map((part) => part.trim());
  if (mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml') {
    return false;
  }
  const charset = parameters
    .find((parameter) => parameter.startsWith('charset='))
    ?.slice('charset='.length)
    .replace(/^"|"$/gu, '');
  if (charset && charset !== 'utf-8' && charset !== 'utf8') return false;
  const contentLength = headers['content-length'];
  return (
    contentLength === undefined ||
    (typeof contentLength === 'string' &&
      /^(0|[1-9][0-9]*)$/u.test(contentLength) &&
      Number(contentLength) <= maxResponseBytes)
  );
}

function validContentEncoding(
  headers: Readonly<Record<string, unknown>>,
): boolean {
  const encoding = headers['content-encoding'];
  return (
    encoding === undefined ||
    (typeof encoding === 'string' &&
      encoding.toLowerCase().trim() === 'identity')
  );
}

function isAsyncByteStream(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function'
  );
}

async function readBody(
  body: AsyncIterable<Uint8Array>,
  now: () => number,
  deadlineAtMs: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  const bytes = await consumeBody(body, now, deadlineAtMs, signal);
  if (!bytes) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

async function consumeBody(
  body: AsyncIterable<Uint8Array>,
  now: () => number,
  deadlineAtMs: number,
  signal: AbortSignal,
): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      if (
        !(chunk instanceof Uint8Array) ||
        now() >= deadlineAtMs ||
        signal.aborted
      ) {
        return undefined;
      }
      total += chunk.byteLength;
      if (total > maxResponseBytes) return undefined;
      chunks.push(chunk);
    }
  } catch {
    return undefined;
  }
  if (now() >= deadlineAtMs || signal.aborted) return undefined;
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function createDeadlineSignal(
  externalSignal: AbortSignal | undefined,
  deadlineAtMs: number,
  now: () => number,
) {
  const controller = new AbortController();
  const relayAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) relayAbort();
  else externalSignal?.addEventListener('abort', relayAbort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException('Deadline exceeded.', 'TimeoutError')),
    Math.min(Math.max(0, deadlineAtMs - now()), 2_147_483_647),
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', relayAbort);
      if (!controller.signal.aborted) {
        controller.abort(new DOMException('Request completed.', 'AbortError'));
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
