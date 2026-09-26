export interface AgentSettings {
  agentApiKey: string;
  agentBaseUrl: string;
  agentModel: string;
}

export type AgentSettingsFallback = Partial<AgentSettings>;
export interface SettingsStore {
  read(): Promise<string | null>;
  write(ciphertext: string): Promise<void>;
  remove(): Promise<void>;
}

const purpose = new TextEncoder().encode('japan-atlas/owner-agent-settings/v1');
const allowedBases = new Set([
  'https://api.deepseek.com',
  'https://api.deepseek.com/v1',
  'https://api.openai.com/v1',
]);

export function validateAgentBaseUrl(value: string): string {
  const base = value.trim().replace(/\/$/u, '');
  if (!allowedBases.has(base))
    throw new Error(
      'Use https://api.deepseek.com or https://api.openai.com/v1. Other providers are not enabled yet.',
    );
  return base;
}

async function encryptionKey(secret: string | undefined) {
  if (!secret || secret.length < 32)
    throw new Error('Server credential encryption is not configured.');
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: purpose, info: purpose },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export function createAgentSettingsService(
  store: SettingsStore,
  secret: string | undefined,
  fallback: AgentSettingsFallback = {},
  verifyConnection?: (settings: AgentSettings) => Promise<void>,
) {
  async function stored(): Promise<AgentSettings | undefined> {
    const envelope = await store.read();
    if (!envelope) return undefined;
    const { version, iv, ciphertext } = JSON.parse(envelope);
    if (version !== 1) throw new Error('Saved settings cannot be read.');
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(iv), additionalData: purpose },
      await encryptionKey(secret),
      decode(ciphertext),
    );
    const settings = JSON.parse(
      new TextDecoder().decode(decrypted),
    ) as AgentSettings;
    validateAgentBaseUrl(settings.agentBaseUrl);
    return settings;
  }

  async function resolve(): Promise<AgentSettingsFallback> {
    return (await stored()) ?? fallback;
  }

  async function status() {
    const saved = await stored();
    const effective = saved ?? fallback;
    return {
      configured: Boolean(
        effective.agentApiKey && effective.agentBaseUrl && effective.agentModel,
      ),
      source: saved ? 'owner' : effective.agentApiKey ? 'deployment' : 'none',
      baseUrl: effective.agentBaseUrl ?? 'https://api.deepseek.com',
      model: effective.agentModel ?? 'deepseek-flash',
      canSave: Boolean(secret && secret.length >= 32),
    };
  }

  return {
    resolve,
    status,
    async save(input: unknown) {
      if (!input || typeof input !== 'object')
        throw new Error('Provide the model settings.');
      const values = input as Record<string, unknown>;
      if (
        typeof values.baseUrl !== 'string' ||
        typeof values.model !== 'string' ||
        typeof values.apiKey !== 'string'
      )
        throw new Error('Provide a base URL, model and API key.');
      const baseUrl = validateAgentBaseUrl(values.baseUrl);
      const model = values.model.trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u.test(model))
        throw new Error('Provide a valid model identifier.');
      let apiKey = values.apiKey.trim();
      if (!apiKey) {
        const current = await resolve();
        if (
          current.agentBaseUrl?.replace(/\/$/u, '') !== baseUrl ||
          !current.agentApiKey
        )
          throw new Error('Enter a new API key when changing providers.');
        apiKey = current.agentApiKey;
      }
      if (apiKey.length < 8 || apiKey.length > 4096 || /\s/u.test(apiKey))
        throw new Error('Provide a valid API key.');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const payload: AgentSettings = {
        agentApiKey: apiKey,
        agentBaseUrl: baseUrl,
        agentModel: model,
      };
      const key = await encryptionKey(secret);
      if (verifyConnection) await verifyConnection(payload);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: purpose },
        key,
        new TextEncoder().encode(JSON.stringify(payload)),
      );
      await store.write(
        JSON.stringify({
          version: 1,
          iv: encode(iv),
          ciphertext: encode(new Uint8Array(ciphertext)),
        }),
      );
      return status();
    },
    async remove() {
      await store.remove();
      return status();
    },
  };
}

/** No private restaurant data is sent. A bounded tool call checks this exact key/model pair. */
export class AgentConnectionError extends Error {}

export async function verifyAgentConnection(
  settings: AgentSettings,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const baseUrl = validateAgentBaseUrl(settings.agentBaseUrl);
  const response = await fetcher(`${baseUrl}/chat/completions`, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.agentApiKey}`,
    },
    body: JSON.stringify({
      model: settings.agentModel,
      max_tokens: 128,
      ...(baseUrl.startsWith('https://api.deepseek.com')
        ? { reasoning_effort: 'none' }
        : {}),
      messages: [
        {
          role: 'user',
          content: 'Call the connection_check tool with empty arguments.',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'connection_check',
            description: 'A no-op connection check.',
            parameters: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'connection_check' } },
    }),
  }).catch(() => {
    throw new AgentConnectionError(
      'The model endpoint could not be reached from this server within 15 seconds.',
    );
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new AgentConnectionError(
      `The model provider returned HTTP ${response.status}. Check API key, model access and credit.`,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new Error('Provider response exceeded the connection-check limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  const calls = result?.choices?.[0]?.message?.tool_calls;
  if (
    !Array.isArray(calls) ||
    calls.length !== 1 ||
    calls[0]?.function?.name !== 'connection_check'
  )
    throw new AgentConnectionError(
      'This model did not support the required tool call.',
    );
}

export function createD1AgentSettingsStore(
  database: D1Database,
): SettingsStore {
  return {
    async read() {
      const row = await database
        .prepare(
          'SELECT ciphertext FROM owner_agent_settings WHERE singleton = 1',
        )
        .first<{ ciphertext: string }>();
      return row?.ciphertext ?? null;
    },
    async write(ciphertext) {
      await database
        .prepare(
          'INSERT INTO owner_agent_settings (singleton, ciphertext) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET ciphertext = excluded.ciphertext',
        )
        .bind(ciphertext)
        .run();
    },
    async remove() {
      await database
        .prepare('DELETE FROM owner_agent_settings WHERE singleton = 1')
        .run();
    },
  };
}
