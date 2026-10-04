import assert from 'node:assert/strict';
import test from 'node:test';

import { createOwnerAuth } from './owner-session.ts';
import { protectOwnerWrite } from './owner-write-guard.ts';

const secrets = {
  ATLAS_OWNER_PASSWORD: 'dummy-owner-password',
  ATLAS_OWNER_SESSION_SECRET: 'dummy-session-secret-with-at-least-32-bytes',
};
const loginTime = new Date('2026-09-21T12:00:00.000Z');

void test('POST, PUT, PATCH, and DELETE reject before any application pipeline work', async () => {
  const auth = createOwnerAuth(secrets, { now: () => loginTime });
  const fake = observableWritePipeline();
  const guarded = protectOwnerWrite(auth, fake.handler);

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await guarded(unsafeRequest(method, '/api/test-write'));
    assert.equal(response.status, 401, method);
  }

  assert.deepEqual(fake.calls, zeroCalls());
});

void test('missing, tampered, expired, and logged-out sessions all reject before the application pipeline', async () => {
  const loginAuth = createOwnerAuth(secrets, { now: () => loginTime });
  const cookie = await loginCookie(loginAuth);
  const logout = await loginAuth.logout(
    unsafeRequest('DELETE', '/api/auth/owner', cookie),
  );
  const loggedOutCookie = firstCookie(logout.headers.get('set-cookie') ?? '');
  const cases = [
    { name: 'missing', auth: loginAuth, cookie: undefined },
    { name: 'tampered', auth: loginAuth, cookie: tamperCookie(cookie) },
    {
      name: 'expired',
      auth: createOwnerAuth(secrets, {
        now: () => new Date('2026-10-22T12:00:00.000Z'),
      }),
      cookie,
    },
    { name: 'logged-out', auth: loginAuth, cookie: loggedOutCookie },
  ];

  for (const candidate of cases) {
    const fake = observableWritePipeline();
    const response = await protectOwnerWrite(
      candidate.auth,
      fake.handler,
    )(unsafeRequest('PATCH', '/api/items/place-1/personal', candidate.cookie));
    assert.equal(response.status, 401, candidate.name);
    assert.deepEqual(fake.calls, zeroCalls(), candidate.name);
  }
});

void test('assessment, Visit, and media requests are rejected before body, application, storage, audit, or receipt work', async () => {
  const auth = createOwnerAuth(secrets, { now: () => loginTime });
  const slices = [
    {
      name: 'assessment',
      method: 'PATCH',
      path: '/api/items/place-1/personal',
    },
    { name: 'Visit', method: 'POST', path: '/api/journal' },
    { name: 'media', method: 'POST', path: '/api/media' },
  ];

  for (const slice of slices) {
    const fake = observableWritePipeline();
    const response = await protectOwnerWrite(
      auth,
      fake.handler,
    )(unsafeRequest(slice.method, slice.path));
    assert.equal(response.status, 401, slice.name);
    assert.deepEqual(fake.calls, zeroCalls(), slice.name);
  }
});

void test('repeated login and denied submission remain independent of the application write pipeline', async () => {
  const auth = createOwnerAuth(secrets, { now: () => loginTime });
  const fake = observableWritePipeline();
  const guarded = protectOwnerWrite(auth, fake.handler);

  const successfulLogins = await Promise.all([
    auth.login(loginRequest('dummy-owner-password')),
    auth.login(loginRequest('dummy-owner-password')),
  ]);
  assert.deepEqual(
    successfulLogins.map(({ status }) => status),
    [200, 200],
  );

  const failedLogins = await Promise.all([
    auth.login(loginRequest('wrong-password')),
    auth.login(loginRequest('wrong-password')),
  ]);
  assert.deepEqual(
    failedLogins.map(({ status }) => status),
    [401, 401],
  );

  const deniedSubmissions = await Promise.all([
    guarded(unsafeRequest('POST', '/api/journal')),
    guarded(unsafeRequest('POST', '/api/journal')),
  ]);
  assert.deepEqual(
    deniedSubmissions.map(({ status }) => status),
    [401, 401],
  );
  assert.deepEqual(fake.calls, zeroCalls());
});

function observableWritePipeline() {
  const calls = zeroCalls();
  return {
    calls,
    handler: async (request) => {
      calls.body += 1;
      await request.text();
      calls.application += 1;
      calls.storage += 1;
      calls.audit += 1;
      calls.receipt += 1;
      return Response.json({ written: true });
    },
  };
}

function zeroCalls() {
  return {
    body: 0,
    application: 0,
    storage: 0,
    audit: 0,
    receipt: 0,
  };
}

function unsafeRequest(method, path, cookie) {
  const url = `https://atlas.example${path}`;
  return new Request(url, {
    method,
    headers: {
      origin: new URL(url).origin,
      ...(cookie ? { cookie } : {}),
    },
    ...(method === 'POST' || method === 'PUT' || method === 'PATCH'
      ? { body: '{"write":true}' }
      : {}),
  });
}

function loginRequest(password) {
  return new Request('https://atlas.example/api/auth/owner', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://atlas.example',
    },
    body: JSON.stringify({ password }),
  });
}

async function loginCookie(auth) {
  const response = await auth.login(loginRequest('dummy-owner-password'));
  assert.equal(response.status, 200);
  return firstCookie(response.headers.get('set-cookie') ?? '');
}

function firstCookie(setCookie) {
  return setCookie.split(';', 1)[0];
}

function tamperCookie(cookie) {
  const separator = cookie.lastIndexOf('.');
  assert.ok(separator > 0);
  const character = cookie[separator + 1];
  return `${cookie.slice(0, separator + 1)}${character === 'a' ? 'b' : 'a'}${cookie.slice(separator + 2)}`;
}
