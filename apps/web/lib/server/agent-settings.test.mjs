import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  createAgentSettingsService,
  validateAgentBaseUrl,
  verifyAgentConnection,
  createD1AgentSettingsStore,
} from './agent-settings.ts';

const secret = 'server-only-test-secret-at-least-32-characters';
const credentials = {
  agentApiKey: 'test-not-a-real-key',
  agentBaseUrl: 'https://api.deepseek.com',
  agentModel: 'deepseek-flash',
};
function fixture() {
  let ciphertext = null;
  const store = {
    async read() {
      return ciphertext;
    },
    async write(value) {
      ciphertext = value;
    },
    async remove() {
      ciphertext = null;
    },
  };
  return {
    store,
    service: createAgentSettingsService(store, secret, credentials),
  };
}

test('only allowlisted HTTPS model endpoints can receive website credentials', () => {
  assert.equal(
    validateAgentBaseUrl('https://api.deepseek.com/'),
    'https://api.deepseek.com',
  );
  for (const url of [
    'http://api.deepseek.com',
    'https://api.deepseek.com.evil.test',
    'https://localhost',
    'https://127.0.0.1',
    'https://169.254.169.254',
    'https://api.deepseek.com@evil.test',
    'https://api.deepseek.com/?x=1',
    'https://api.deepseek.com:444',
    'https://api.deepseek.com/path',
  ]) {
    assert.throws(() => validateAgentBaseUrl(url));
  }
});

test('saved credentials are encrypted with randomized IV and never projected to the browser', async () => {
  const { store, service } = fixture();
  const input = {
    apiKey: 'another-test-only-key',
    baseUrl: credentials.agentBaseUrl,
    model: credentials.agentModel,
  };
  const status = await service.save(input);
  assert.equal(status.source, 'owner');
  assert.equal(status.configured, true);
  assert.ok(!JSON.stringify(status).includes(input.apiKey));
  const first = await store.read();
  assert.ok(!first.includes(input.apiKey));
  assert.ok(!first.includes(input.model));
  assert.equal((await service.resolve()).agentApiKey, input.apiKey);
  await service.save(input);
  assert.notEqual(await store.read(), first);
});

test('D1 singleton migration supports encrypted save, replacement and deletion', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(
    await readFile(
      new URL(
        '../../migrations/owner-poc/0010_owner_agent_settings.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const database = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        async first() {
          return statement.get() ?? null;
        },
        async run() {
          return statement.run();
        },
        bind(...values) {
          return {
            async run() {
              return statement.run(...values);
            },
          };
        },
      };
    },
  };
  const service = createAgentSettingsService(
    createD1AgentSettingsStore(database),
    secret,
    credentials,
  );
  await service.save({
    apiKey: 'first-test-only-key',
    baseUrl: credentials.agentBaseUrl,
    model: credentials.agentModel,
  });
  await service.save({
    apiKey: 'second-test-only-key',
    baseUrl: credentials.agentBaseUrl,
    model: credentials.agentModel,
  });
  assert.equal((await service.resolve()).agentApiKey, 'second-test-only-key');
  const rows = sqlite
    .prepare('SELECT ciphertext FROM owner_agent_settings')
    .all();
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes('second-test-only-key'));
  await service.remove();
  assert.deepEqual(await service.resolve(), credentials);
  sqlite.close();
});

test('blank key preserves current endpoint only; provider changes require a new key', async () => {
  const { service } = fixture();
  await service.save({
    apiKey: '',
    baseUrl: credentials.agentBaseUrl,
    model: 'deepseek-chat',
  });
  assert.equal((await service.resolve()).agentApiKey, credentials.agentApiKey);
  await assert.rejects(
    service.save({
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'other-model',
    }),
  );
  await service.save({
    apiKey: 'different-provider-test-key',
    baseUrl: 'https://api.openai.com/v1',
    model: 'other-model',
  });
  assert.equal(
    (await service.resolve()).agentApiKey,
    'different-provider-test-key',
  );
  await service.remove();
  assert.deepEqual(await service.resolve(), credentials);
  assert.equal((await service.status()).source, 'deployment');
});

test('missing encryption secret rejects writes; corrupted settings never silently fall back', async () => {
  const { store, service } = fixture();
  const input = {
    apiKey: 'another-test-only-key',
    baseUrl: credentials.agentBaseUrl,
    model: credentials.agentModel,
  };
  await assert.rejects(
    createAgentSettingsService(store, undefined).save(input),
  );
  await service.save(input);
  await assert.rejects(
    createAgentSettingsService(store, secret + '-wrong', credentials).resolve(),
  );
  const envelope = JSON.parse(await store.read());
  envelope.ciphertext = envelope.ciphertext.slice(0, -4) + 'AAAA';
  await store.write(JSON.stringify(envelope));
  await assert.rejects(service.resolve());
});

test('empty deployment is unconfigured and rejects missing API key', async () => {
  const { store } = fixture();
  const service = createAgentSettingsService(store, secret);
  assert.equal((await service.status()).configured, false);
  await assert.rejects(
    service.save({
      apiKey: '',
      baseUrl: credentials.agentBaseUrl,
      model: credentials.agentModel,
    }),
  );
});

test('failed connection check does not replace persisted credentials', async () => {
  const { store, service } = fixture();
  await service.save({
    apiKey: 'original-test-only-key',
    baseUrl: credentials.agentBaseUrl,
    model: credentials.agentModel,
  });
  const before = await store.read();
  const checked = createAgentSettingsService(
    store,
    secret,
    credentials,
    async () => {
      throw new Error('provider unavailable');
    },
  );
  await assert.rejects(
    checked.save({
      apiKey: 'replacement-test-only-key',
      baseUrl: credentials.agentBaseUrl,
      model: credentials.agentModel,
    }),
  );
  assert.equal(await store.read(), before);
});

test('connection check is bounded, blocks redirects, and verifies actual tool support', async () => {
  let request;
  await verifyAgentConnection(credentials, async (url, init) => {
    request = { url, ...init };
    return Response.json({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: 'connection_check', arguments: '{}' } },
            ],
          },
        },
      ],
    });
  });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.redirect, 'manual');
  assert.equal(JSON.parse(request.body).reasoning_effort, 'none');
  assert.equal(JSON.parse(request.body).max_tokens, 128);
  for (const response of [
    new Response(null, {
      status: 302,
      headers: { Location: 'https://untrusted.example' },
    }),
    new Response('denied', { status: 401 }),
    Response.json({ choices: [{ message: { content: 'hello' } }] }),
    new Response('x'.repeat(16_385)),
  ]) {
    await assert.rejects(
      verifyAgentConnection(credentials, async () => response),
    );
  }
});

test('settings reads are owner-only; mutations use existing CSRF/auth guard; responses never cache secrets', async () => {
  const route = await readFile(
    new URL('../../app/api/owner/agent-settings/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(route, /GET = withOwnerReadAuth/u);
  assert.match(route, /PUT = withOwnerWriteAuth/u);
  assert.match(route, /DELETE = withOwnerWriteAuth/u);
  assert.match(route, /'Cache-Control': 'no-store'/u);
  assert.match(route, /size > 8192/u);
  const ui = await readFile(
    new URL('../../features/atlas/owner-agent-settings.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(ui, /localStorage|sessionStorage/u);
  assert.match(ui, /type="password"/u);
  assert.match(ui, /setApiKey\(''\)/u);
});
