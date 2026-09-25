import type { ResearchRelayRpcPort } from './research-relay-web-research-port.ts';

const maximumRelayResponseBytes = 64 * 1024;
const maximumSecretCharacters = 4_096;

export function createHttpResearchRelayRpc(dependencies: {
  readonly endpoint: string;
  readonly bearerSecret: string;
  readonly fetch?: typeof fetch;
}): ResearchRelayRpcPort {
  const endpoint = validateEndpoint(dependencies.endpoint);
  if (!endpoint || !validSecret(dependencies.bearerSecret)) {
    throw new TypeError('Research Relay RPC configuration is invalid.');
  }
  const fetchImpl = dependencies.fetch ?? fetch;
  return {
    async invoke(input) {
      if (
        input.maxAttempts !== 1 ||
        input.redirect !== 'error' ||
        input.signal.aborted ||
        Date.now() >= input.deadlineAtMs
      ) {
        throw new TypeError('Research Relay RPC request is invalid.');
      }
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${dependencies.bearerSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          allowance: input.allowance,
          payload: input.payload,
        }),
        signal: input.signal,
      });
      if (!response.ok || response.status !== 200) {
        throw new TypeError('Research Relay RPC request failed.');
      }
      return readBoundedJson(response, maximumRelayResponseBytes);
    },
  };
}

function validateEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.pathname !== '/v1/research'
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function validSecret(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= 32 &&
    value.length <= maximumSecretCharacters &&
    !hasAsciiControlCharacter(value)
  );
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new TypeError('Research Relay RPC response is not JSON.');
  }
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > maximumBytes)
  ) {
    throw new TypeError('Research Relay RPC response is too large.');
  }
  if (!response.body)
    throw new TypeError('Research Relay RPC response is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new TypeError('Research Relay RPC response is too large.');
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
