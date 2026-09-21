export const ownerSessionCookieName = '__Host-atlas_owner';

const sessionVersion = 1;
const sessionLifetimeSeconds = 30 * 24 * 60 * 60;
const textEncoder = new TextEncoder();

export interface OwnerAuthSecrets {
  readonly ATLAS_OWNER_PASSWORD?: string;
  readonly ATLAS_OWNER_SESSION_SECRET?: string;
}

export interface OwnerAuthClock {
  now(): Date;
}

export interface OwnerAuth {
  status(request: Request): Promise<Response>;
  login(request: Request): Promise<Response>;
  logout(request: Request): Promise<Response>;
  authorizeRead(request: Request): Promise<Response | undefined>;
  authorizeWrite(request: Request): Promise<Response | undefined>;
}

interface OwnerSessionPayload {
  readonly version: number;
  readonly subject: 'owner';
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export function createOwnerAuth(
  secrets: OwnerAuthSecrets,
  clock: OwnerAuthClock = { now: () => new Date() },
): OwnerAuth {
  return {
    async status(request) {
      const authenticated = await hasValidOwnerSession(request, secrets, clock);
      return noStoreJson({ authenticated });
    },
    async login(request) {
      const originFailure = enforceSameOrigin(request);
      if (originFailure) return originFailure;
      if (!hasConfiguredSecrets(secrets)) return unavailableResponse();

      const password = await readPassword(request);
      if (
        password === undefined ||
        !(await constantTimePasswordMatches(password, secrets))
      ) {
        return noStoreResponse('Invalid owner credentials.', 401);
      }

      const nowSeconds = Math.floor(clock.now().getTime() / 1000);
      const token = await signSession(
        {
          version: sessionVersion,
          subject: 'owner',
          issuedAt: nowSeconds,
          expiresAt: nowSeconds + sessionLifetimeSeconds,
        },
        secrets.ATLAS_OWNER_SESSION_SECRET,
      );
      const response = noStoreJson({ authenticated: true });
      response.headers.append(
        'set-cookie',
        `${ownerSessionCookieName}=${token}; Path=/; Max-Age=${sessionLifetimeSeconds}; HttpOnly; Secure; SameSite=Strict`,
      );
      return response;
    },
    async logout(request) {
      const originFailure = enforceSameOrigin(request);
      if (originFailure) return originFailure;
      const response = noStoreResponse(null, 204);
      response.headers.append(
        'set-cookie',
        `${ownerSessionCookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
      );
      return response;
    },
    async authorizeRead(request) {
      if (!hasConfiguredSecrets(secrets)) return unavailableResponse();
      return (await hasValidOwnerSession(request, secrets, clock))
        ? undefined
        : noStoreResponse('Owner login is required.', 401);
    },
    async authorizeWrite(request) {
      const originFailure = enforceSameOrigin(request);
      if (originFailure) return originFailure;
      if (!hasConfiguredSecrets(secrets)) return unavailableResponse();
      return (await hasValidOwnerSession(request, secrets, clock))
        ? undefined
        : noStoreResponse('Owner login is required.', 401);
    },
  };
}

async function hasValidOwnerSession(
  request: Request,
  secrets: OwnerAuthSecrets,
  clock: OwnerAuthClock,
): Promise<boolean> {
  if (!hasConfiguredSecrets(secrets)) return false;
  const token = readCookie(
    request.headers.get('cookie'),
    ownerSessionCookieName,
  );
  if (!token) return false;
  const separator = token.indexOf('.');
  if (separator <= 0 || separator !== token.lastIndexOf('.')) return false;
  const encodedPayload = token.slice(0, separator);
  const encodedSignature = token.slice(separator + 1);
  const signature = decodeBase64Url(encodedSignature);
  if (!signature) return false;
  const key = await importHmacKey(secrets.ATLAS_OWNER_SESSION_SECRET);
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      key,
      copyToArrayBuffer(signature),
      textEncoder.encode(encodedPayload),
    ))
  ) {
    return false;
  }

  const payload = parseSessionPayload(encodedPayload);
  if (!payload) return false;
  const nowSeconds = Math.floor(clock.now().getTime() / 1000);
  return (
    payload.version === sessionVersion &&
    payload.subject === 'owner' &&
    payload.issuedAt <= nowSeconds &&
    payload.expiresAt > nowSeconds &&
    payload.expiresAt - payload.issuedAt === sessionLifetimeSeconds
  );
}

async function constantTimePasswordMatches(
  candidate: string,
  secrets: Required<OwnerAuthSecrets>,
): Promise<boolean> {
  const key = await importHmacKey(secrets.ATLAS_OWNER_SESSION_SECRET);
  const expected = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(secrets.ATLAS_OWNER_PASSWORD),
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    expected,
    textEncoder.encode(candidate),
  );
}

async function signSession(
  payload: OwnerSessionPayload,
  secret: string,
): Promise<string> {
  const encodedPayload = encodeBase64Url(
    textEncoder.encode(JSON.stringify(payload)),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importHmacKey(secret),
    textEncoder.encode(encodedPayload),
  );
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function parseSessionPayload(encoded: string): OwnerSessionPayload | undefined {
  try {
    const bytes = decodeBase64Url(encoded);
    if (!bytes) return undefined;
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(value)) return undefined;
    if (
      typeof value.version !== 'number' ||
      value.subject !== 'owner' ||
      typeof value.issuedAt !== 'number' ||
      !Number.isInteger(value.issuedAt) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isInteger(value.expiresAt)
    ) {
      return undefined;
    }
    return {
      version: value.version,
      subject: value.subject,
      issuedAt: value.issuedAt,
      expiresAt: value.expiresAt,
    };
  } catch {
    return undefined;
  }
}

function enforceSameOrigin(request: Request): Response | undefined {
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin
    ? undefined
    : noStoreResponse('Cross-origin requests are not allowed.', 403);
}

async function readPassword(request: Request): Promise<string | undefined> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return undefined;
  }
  try {
    const value: unknown = await request.json();
    if (!isRecord(value) || Object.keys(value).length !== 1) return undefined;
    return typeof value.password === 'string' && value.password.length <= 256
      ? value.password
      : undefined;
  } catch {
    return undefined;
  }
}

function hasConfiguredSecrets(
  secrets: OwnerAuthSecrets,
): secrets is Required<OwnerAuthSecrets> {
  return (
    typeof secrets.ATLAS_OWNER_PASSWORD === 'string' &&
    secrets.ATLAS_OWNER_PASSWORD.length > 0 &&
    typeof secrets.ATLAS_OWNER_SESSION_SECRET === 'string' &&
    secrets.ATLAS_OWNER_SESSION_SECRET.length >= 32
  );
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim() || undefined;
  }
  return undefined;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = `${standard}${'='.repeat((4 - (standard.length % 4)) % 4)}`;
    return Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return undefined;
  }
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function noStoreJson(value: unknown, status = 200): Response {
  const response = Response.json(value, { status });
  response.headers.set('cache-control', 'no-store');
  return response;
}

function noStoreResponse(body: BodyInit | null, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function unavailableResponse(): Response {
  return noStoreResponse('Owner authentication is unavailable.', 503);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
