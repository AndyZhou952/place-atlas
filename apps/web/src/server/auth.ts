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

/** Add endpoints also accept the external agent's Bearer token. */
export async function requireOwnerOrAddAgent(request: Request, env: Env): Promise<void> {
  const token = env.ATLAS_ADD_AGENT_TOKEN;
  const bearer = request.headers.get('authorization')?.match(/^Bearer (\S+)$/u)?.[1];
  if (token && token.length >= 32 && bearer) {
    if (await timingSafeEqual(bearer, token)) return;
    throw new HttpError(401, 'Invalid token.');
  }
  await requireOwner(request, env);
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
