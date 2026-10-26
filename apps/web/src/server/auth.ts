import type { Env } from './env.ts';
import { HttpError, json, readJson } from './http.ts';

// Session cookie format (unchanged since 0.1): base64url(JSON payload) "." base64url(HMAC-SHA256).
const COOKIE = '__Host-atlas_owner';
const LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

interface OwnerSecrets {
  readonly password: string;
  readonly secret: string;
}

function secrets(env: Env): OwnerSecrets | undefined {
  const password = env.ATLAS_OWNER_PASSWORD;
  const secret = env.ATLAS_OWNER_SESSION_SECRET;
  return password && secret && secret.length >= 32 ? { password, secret } : undefined;
}

const hmacKey = (secret: string) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/');
    return Uint8Array.from(atob(standard + '='.repeat((4 - (standard.length % 4)) % 4)), (c) =>
      c.charCodeAt(0),
    );
  } catch {
    return undefined;
  }
}

function readCookie(request: Request): string | undefined {
  for (const part of request.headers.get('cookie')?.split(';') ?? []) {
    const [name, ...rest] = part.split('=');
    if (name.trim() === COOKIE) return rest.join('=').trim() || undefined;
  }
  return undefined;
}

export async function isOwner(request: Request, env: Env, now = Date.now()): Promise<boolean> {
  const configured = secrets(env);
  const token = readCookie(request);
  const [payload, signature, extra] = token?.split('.') ?? [];
  const signatureBytes = signature ? fromBase64Url(signature) : undefined;
  if (!configured || !payload || !signatureBytes || extra !== undefined) return false;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(configured.secret),
    signatureBytes,
    encoder.encode(payload),
  );
  if (!valid) return false;
  try {
    const session = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    const seconds = Math.floor(now / 1000);
    return (
      session.version === 1 &&
      session.subject === 'owner' &&
      session.issuedAt <= seconds &&
      session.expiresAt > seconds &&
      session.expiresAt - session.issuedAt === LIFETIME_SECONDS
    );
  } catch {
    return false;
  }
}

/** Browser writes must come from this origin; the cookie is also SameSite=Strict. */
function assertSameOrigin(request: Request): void {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    throw new HttpError(403, 'Cross-origin requests are not allowed.');
  }
}

export async function requireOwner(request: Request, env: Env): Promise<void> {
  if (!secrets(env)) throw new HttpError(503, 'Owner authentication is not configured.');
  if (request.method !== 'GET') assertSameOrigin(request);
  if (!(await isOwner(request, env))) throw new HttpError(401, 'Owner login is required.');
}

const hex16 = (signature: ArrayBuffer) =>
  Array.from(new Uint8Array(signature).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

/**
 * Add sessions are scoped to a conversation: the Owner's web conversation is derived from the
 * session cookie, so a new login starts a new conversation.
 */
export async function ownerWebConversationId(request: Request, env: Env): Promise<string> {
  await requireOwner(request, env);
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env.ATLAS_OWNER_SESSION_SECRET!),
    encoder.encode(`atlas:web-conversation:v1:${readCookie(request)}`),
  );
  return hex16(signature);
}

/** The external Add Agent uses a Bearer token (never with a cookie); returns its conversation. */
export async function addAgentConversationId(request: Request, env: Env): Promise<string> {
  const configured = env.ATLAS_ADD_AGENT_TOKEN;
  const signingSecret = env.ATLAS_OWNER_SESSION_SECRET;
  if (
    !configured ||
    !/^[A-Za-z0-9_-]{32,128}$/u.test(configured) ||
    !signingSecret ||
    signingSecret.length < 32
  )
    throw new HttpError(503, 'Add Agent authentication is unavailable.');
  const candidate = /^Bearer ([A-Za-z0-9_-]{32,128})$/u.exec(
    request.headers.get('authorization') ?? '',
  )?.[1];
  if (
    !candidate ||
    request.headers.has('cookie') ||
    !(await timingSafeEqual(candidate, configured))
  )
    throw new HttpError(401, 'Add Agent authentication is required.');
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(signingSecret),
    encoder.encode(`atlas:add-agent-conversation:v1:${candidate}`),
  );
  return hex16(signature);
}

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const key = await hmacKey('compare');
  const [a, b] = await Promise.all(
    [left, right].map((value) => crypto.subtle.sign('HMAC', key, encoder.encode(value))),
  );
  return base64Url(new Uint8Array(a)) === base64Url(new Uint8Array(b));
}

export async function login(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request);
  const configured = secrets(env);
  if (!configured) throw new HttpError(503, 'Owner authentication is not configured.');
  const { password } = await readJson(request, 1024);
  if (typeof password !== 'string' || !(await timingSafeEqual(password, configured.password))) {
    throw new HttpError(401, 'Invalid owner credentials.');
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = base64Url(
    encoder.encode(
      JSON.stringify({
        version: 1,
        subject: 'owner',
        issuedAt,
        expiresAt: issuedAt + LIFETIME_SECONDS,
      }),
    ),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(configured.secret),
    encoder.encode(payload),
  );
  const response = json({ owner: true });
  response.headers.append(
    'set-cookie',
    `${COOKIE}=${payload}.${base64Url(new Uint8Array(signature))}; Path=/; Max-Age=${LIFETIME_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
  );
  return response;
}

export function logout(request: Request): Response {
  assertSameOrigin(request);
  const response = json({ owner: false });
  response.headers.append(
    'set-cookie',
    `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
  );
  return response;
}
