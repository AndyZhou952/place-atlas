const encoder = new TextEncoder();

export const agentSignatureHeaders = {
  keyId: 'x-atlas-key-id',
  timestamp: 'x-atlas-timestamp',
  nonce: 'x-atlas-nonce',
  signature: 'x-atlas-signature',
} as const;

export interface AgentCanonicalRequest {
  readonly method: string;
  readonly url: string;
  readonly bodyDigest: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly keyId: string;
}

export function canonicalAgentRequestBytes(
  request: AgentCanonicalRequest,
): string {
  return [
    request.method.toUpperCase(),
    canonicalPathAndQuery(request.url),
    request.bodyDigest,
    request.timestamp,
    request.nonce,
    request.keyId,
  ].join('\n');
}

export async function signAgentHttpRequest(input: {
  readonly url: string;
  readonly method: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly keyId: string;
  readonly secret: string;
  readonly timestamp: string;
  readonly nonce: string;
}): Promise<Request> {
  const body = JSON.stringify(input.body);
  const bodyDigest = await sha256Hex(encoder.encode(body));
  const signature = await hmacSha256Hex(
    input.secret,
    canonicalAgentRequestBytes({ ...input, bodyDigest }),
  );
  return new Request(input.url, {
    method: input.method,
    headers: {
      'content-type': 'application/json',
      [agentSignatureHeaders.keyId]: input.keyId,
      [agentSignatureHeaders.timestamp]: input.timestamp,
      [agentSignatureHeaders.nonce]: input.nonce,
      [agentSignatureHeaders.signature]: signature,
    },
    body,
  });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyAgentHmac(
  secret: string,
  canonicalBytes: string,
  signatureHex: string,
): Promise<boolean> {
  const signature = hexToBytes(signatureHex);
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    Uint8Array.from(signature).buffer,
    encoder.encode(canonicalBytes),
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

async function hmacSha256Hex(
  secret: string,
  canonicalBytes: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(canonicalBytes),
  );
  return bytesToHex(new Uint8Array(signature));
}

function canonicalPathAndQuery(input: string): string {
  const url = new URL(input);
  const parameters = [...url.searchParams.entries()].sort(
    ([leftName, leftValue], [rightName, rightValue]) =>
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue),
  );
  const query = new URLSearchParams(parameters).toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(value: string): Uint8Array | undefined {
  if (!/^[a-f0-9]{64}$/u.test(value)) return undefined;
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}
