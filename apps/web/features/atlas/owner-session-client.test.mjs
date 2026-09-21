import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOwnerSessionClient,
  publishOwnerLoginRequired,
  subscribeOwnerLoginRequired,
} from './owner-session-client.ts';

void test('Owner session client checks status, logs in, and logs out through the same-origin auth route', async () => {
  const calls = [];
  const client = createOwnerSessionClient({
    async request(url, init) {
      calls.push({ url, init });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ authenticated: init?.method === 'POST' });
    },
  });

  assert.deepEqual(await client.status(), { authenticated: false });
  assert.deepEqual(await client.login('not-a-real-password'), {
    authenticated: true,
  });
  await client.logout();

  assert.deepEqual(
    calls.map(({ url, init }) => ({
      url,
      method: init?.method ?? 'GET',
      credentials: init?.credentials,
      body: init?.body,
    })),
    [
      {
        url: '/api/auth/owner',
        method: 'GET',
        credentials: 'same-origin',
        body: undefined,
      },
      {
        url: '/api/auth/owner',
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({ password: 'not-a-real-password' }),
      },
      {
        url: '/api/auth/owner',
        method: 'DELETE',
        credentials: 'same-origin',
        body: undefined,
      },
    ],
  );
});

void test('Owner session failures use stable public messages without exposing arbitrary server text', async () => {
  const client = createOwnerSessionClient({
    async request() {
      return new Response(
        'internal upstream detail: request-id=secret-infrastructure-id',
        { status: 401 },
      );
    },
  });

  const error = await client.login('not-a-real-password').then(
    () => undefined,
    (reason) => reason,
  );
  assert.match(error?.message ?? '', /password was not accepted/i);
  assert.doesNotMatch(error?.message ?? '', /request-id|infrastructure/i);
});

void test('an unauthorized write can request the shared Owner login region', () => {
  let requests = 0;
  const unsubscribe = subscribeOwnerLoginRequired(() => {
    requests += 1;
  });

  publishOwnerLoginRequired();
  unsubscribe();
  publishOwnerLoginRequired();

  assert.equal(requests, 1);
});
