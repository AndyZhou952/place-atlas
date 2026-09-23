import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOwnerAuth,
  deriveOwnerWebConversationId,
  ownerSessionCookieName,
} from './owner-session.ts';

const secrets = {
  ATLAS_OWNER_PASSWORD: 'dummy-owner-password',
  ATLAS_OWNER_SESSION_SECRET: 'dummy-session-secret-with-at-least-32-bytes',
};

void test('the owner can log in and the signed cookie authenticates a later request', async () => {
  const auth = createOwnerAuth(secrets, {
    now: () => new Date('2026-09-21T12:00:00.000Z'),
  });
  const login = await auth.login(
    jsonRequest('https://atlas.example/api/auth/owner', {
      password: 'dummy-owner-password',
    }),
  );

  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const setCookie = login.headers.get('set-cookie') ?? '';
  assert.match(setCookie, new RegExp(`^${ownerSessionCookieName}=`));
  assert.match(setCookie, /; Path=\//u);
  assert.match(setCookie, /; HttpOnly/u);
  assert.match(setCookie, /; Secure/u);
  assert.match(setCookie, /; SameSite=Strict/u);

  const cookie = setCookie.split(';', 1)[0];
  const status = await auth.status(
    new Request('https://atlas.example/api/auth/owner', {
      headers: { cookie },
    }),
  );

  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { authenticated: true });
});

void test('wrong credentials, a tampered cookie, and an expired cookie never authenticate', async () => {
  const loginTime = new Date('2026-09-21T12:00:00.000Z');
  const auth = createOwnerAuth(secrets, { now: () => loginTime });
  const wrong = await auth.login(
    jsonRequest('https://atlas.example/api/auth/owner', {
      password: 'wrong-password',
    }),
  );
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);

  const login = await auth.login(
    jsonRequest('https://atlas.example/api/auth/owner', {
      password: 'dummy-owner-password',
    }),
  );
  const cookie = (login.headers.get('set-cookie') ?? '').split(';', 1)[0];
  const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('a') ? 'b' : 'a'}`;
  assert.deepEqual(await statusJson(auth, tampered), {
    authenticated: false,
  });

  const expiredAuth = createOwnerAuth(secrets, {
    now: () => new Date('2026-10-22T12:00:00.000Z'),
  });
  assert.deepEqual(await statusJson(expiredAuth, cookie), {
    authenticated: false,
  });
});

void test('unsafe browser requests require the exact origin and a valid owner cookie', async () => {
  const auth = createOwnerAuth(secrets, {
    now: () => new Date('2026-09-21T12:00:00.000Z'),
  });
  const anonymous = await auth.authorizeWrite(
    unsafeRequest('https://atlas.example/api/items/place-1/personal'),
  );
  assert.equal(anonymous?.status, 401);
  assert.equal(anonymous?.headers.get('cache-control'), 'no-store');

  const crossOrigin = await auth.authorizeWrite(
    unsafeRequest('https://atlas.example/api/items/place-1/personal', {
      origin: 'https://evil.example',
    }),
  );
  assert.equal(crossOrigin?.status, 403);

  const login = await auth.login(
    jsonRequest('https://atlas.example/api/auth/owner', {
      password: 'dummy-owner-password',
    }),
  );
  const cookie = (login.headers.get('set-cookie') ?? '').split(';', 1)[0];
  const allowed = await auth.authorizeWrite(
    unsafeRequest('https://atlas.example/api/items/place-1/personal', {
      cookie,
    }),
  );
  assert.equal(allowed, undefined);
});

void test('the server derives a stable opaque Web conversation only from a valid owner session', async () => {
  const clock = { now: () => new Date('2026-09-21T12:00:00.000Z') };
  const auth = createOwnerAuth(secrets, clock);
  const login = await auth.login(
    jsonRequest('https://atlas.example/api/auth/owner', {
      password: 'dummy-owner-password',
    }),
  );
  const cookie = (login.headers.get('set-cookie') ?? '').split(';', 1)[0];
  const request = new Request(
    'https://atlas.example/api/catalog-intake/discover',
    { headers: { cookie } },
  );

  const first = await deriveOwnerWebConversationId(request, secrets, clock);
  const retry = await deriveOwnerWebConversationId(request, secrets, clock);
  assert.match(first ?? '', /^[a-f0-9]{32}$/u);
  assert.equal(retry, first);

  const tampered = `${cookie.slice(0, -1)}${cookie.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(
    await deriveOwnerWebConversationId(
      new Request(request.url, { headers: { cookie: tampered } }),
      secrets,
      clock,
    ),
    undefined,
  );
});

void test('logout clears the owner cookie and never caches its response', async () => {
  const auth = createOwnerAuth(secrets);
  const response = await auth.logout(
    new Request('https://atlas.example/api/auth/owner', {
      method: 'DELETE',
      headers: { origin: 'https://atlas.example' },
    }),
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/u);
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/u);
  assert.match(response.headers.get('set-cookie') ?? '', /Secure/u);
  assert.match(response.headers.get('set-cookie') ?? '', /SameSite=Strict/u);
});

void test('missing secrets fail closed without echoing configuration details', async () => {
  const auth = createOwnerAuth({});
  const login = await auth.login(
    jsonRequest('https://atlas.example/api/auth/owner', {
      password: 'anything',
    }),
  );
  const write = await auth.authorizeWrite(
    unsafeRequest('https://atlas.example/api/journal'),
  );

  assert.equal(login.status, 503);
  assert.equal(write?.status, 503);
  assert.doesNotMatch(await login.text(), /password|secret|ATLAS_OWNER/iu);
});

function jsonRequest(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: new URL(url).origin,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function unsafeRequest(url, headers = {}) {
  return new Request(url, {
    method: 'PATCH',
    headers: { origin: new URL(url).origin, ...headers },
  });
}

async function statusJson(auth, cookie) {
  const response = await auth.status(
    new Request('https://atlas.example/api/auth/owner', {
      headers: { cookie },
    }),
  );
  return response.json();
}
