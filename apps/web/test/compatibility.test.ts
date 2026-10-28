import assert from 'node:assert/strict';
import test from 'node:test';
import { isOwner, login, requireOwner } from '../src/server/auth.ts';
import type { Env } from '../src/server/env.ts';
import { HttpError } from '../src/server/http.ts';
import { resolveAgentSettings } from '../src/server/settings.ts';

const secret = '0123456789abcdef0123456789abcdef-secret';
const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');

/** A fake D1 that answers the settings query with one stored envelope. */
function envWith(ciphertext?: string): Env {
  const statement = {
    bind: () => statement,
    first: async () => (ciphertext ? { ciphertext } : null),
  };
  return {
    ATLAS_OWNER_PASSWORD: 'pw',
    ATLAS_OWNER_SESSION_SECRET: secret,
    DB: { prepare: () => statement } as unknown as D1Database,
    MEDIA: {} as R2Bucket,
  };
}

test('a session cookie issued by the preview build is still accepted', async () => {
  const issuedAt = Math.floor(Date.now() / 1000) - 60;
  const payload = b64url(
    encoder.encode(
      JSON.stringify({ version: 1, subject: 'owner', issuedAt, expiresAt: issuedAt + 2_592_000 }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = b64url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))),
  );
  const request = (cookie: string) =>
    new Request('https://atlas.test/api/session', { headers: { cookie } });
  assert.equal(
    await isOwner(request(`__Host-atlas_owner=${payload}.${signature}`), envWith()),
    true,
  );
  assert.equal(
    await isOwner(request(`__Host-atlas_owner=${payload}.${signature.slice(1)}x`), envWith()),
    false,
  );
});

test('login sets the same cookie; writes need the same origin', async () => {
  const env = envWith();
  const post = (origin: string, password: string) =>
    new Request('https://atlas.test/api/session', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  await assert.rejects(
    login(post('https://atlas.test', 'wrong'), env),
    (error: HttpError) => error.status === 401,
  );
  await assert.rejects(
    login(post('https://evil.test', 'pw'), env),
    (error: HttpError) => error.status === 403,
  );
  const cookie = (await login(post('https://atlas.test', 'pw'), env)).headers
    .get('set-cookie')!
    .split(';')[0];
  const write = (origin: string) =>
    new Request('https://atlas.test/api/visits', { method: 'POST', headers: { cookie, origin } });
  await requireOwner(write('https://atlas.test'), env);
  await assert.rejects(
    requireOwner(write('https://evil.test'), env),
    (error: HttpError) => error.status === 403,
  );
});

test('model settings saved by the preview build still decrypt', async () => {
  // Reproduces the preview build's envelope: HKDF(secret) → AES-GCM with the purpose as AAD.
  const purpose = encoder.encode('japan-atlas/owner-agent-settings/v1');
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: purpose, info: purpose },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = {
    agentApiKey: 'sk-test-123456',
    agentBaseUrl: 'https://api.deepseek.com',
    agentModel: 'deepseek-flash',
  };
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: purpose },
    key,
    encoder.encode(JSON.stringify(plain)),
  );
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const envelope = JSON.stringify({
    version: 1,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  });
  assert.deepEqual(await resolveAgentSettings(envWith(envelope)), {
    agentApiKey: 'sk-test-123456',
    agentBaseUrl: 'https://api.deepseek.com',
    agentModel: 'deepseek-flash',
  });
  assert.deepEqual(await resolveAgentSettings(envWith()), {});
});
