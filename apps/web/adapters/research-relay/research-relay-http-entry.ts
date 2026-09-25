import { timingSafeEqual } from 'node:crypto';

const maximumRequestBytes = 32 * 1024;

export interface ResearchRelayHandlerPort {
  handle(allowance: unknown, payload: unknown): Promise<unknown>;
}

export function inspectResearchRelayRequestHeaders(
  input: {
    readonly method: string;
    readonly path: string;
    readonly authorization?: string;
    readonly contentType?: string;
  },
  bearerSecret: string,
) {
  if (input.method !== 'POST' || input.path !== '/v1/research') {
    return response(404, { status: 'rejected', reason: 'not_found' });
  }
  if (!authorized(input.authorization, bearerSecret)) {
    return response(401, { status: 'rejected', reason: 'unauthorized' });
  }
  if (input.contentType !== 'application/json') {
    return response(400, { status: 'rejected', reason: 'invalid_request' });
  }
  return undefined;
}

export function createResearchRelayHttpEntry(dependencies: {
  readonly bearerSecret: string;
  readonly relay: ResearchRelayHandlerPort;
  readonly cleanup: () => Promise<unknown>;
}) {
  if (!validSecret(dependencies.bearerSecret)) {
    throw new TypeError('Research Relay HTTP configuration is invalid.');
  }
  return {
    async handle(input: {
      readonly method: string;
      readonly path: string;
      readonly authorization?: string;
      readonly contentType?: string;
      readonly body: Uint8Array;
    }) {
      const headerRejection = inspectResearchRelayRequestHeaders(
        input,
        dependencies.bearerSecret,
      );
      if (headerRejection) return headerRejection;
      if (
        input.body.byteLength < 2 ||
        input.body.byteLength > maximumRequestBytes
      ) {
        return response(400, { status: 'rejected', reason: 'invalid_request' });
      }
      let value: unknown;
      try {
        value = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(input.body),
        );
      } catch {
        return response(400, { status: 'rejected', reason: 'invalid_request' });
      }
      if (!isRecord(value) || !hasExactKeys(value, ['allowance', 'payload'])) {
        return response(400, { status: 'rejected', reason: 'invalid_request' });
      }
      try {
        await dependencies.cleanup();
        return response(
          200,
          await dependencies.relay.handle(value.allowance, value.payload),
        );
      } catch {
        return response(503, { status: 'rejected', reason: 'unavailable' });
      }
    },
  };
}

function authorized(header: string | undefined, secret: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const presented = new TextEncoder().encode(header.slice(7));
  const expected = new TextEncoder().encode(secret);
  return (
    presented.byteLength === expected.byteLength &&
    timingSafeEqual(presented, expected)
  );
}

function response(status: number, body: unknown) {
  return {
    status,
    headers: { 'content-type': 'application/json' } as const,
    body: JSON.stringify(body),
  };
}

function validSecret(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length >= 32 &&
    value.length <= 4_096 &&
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
