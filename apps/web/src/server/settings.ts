import type { ModelSettingsStatus } from '../shared/types.ts';
import type { Env } from './env.ts';
import { HttpError, readBoundedText } from './http.ts';

// Owner-saved model credentials. The encrypted envelope is unchanged since 0.1:
// {version:1, iv, ciphertext} with an AES-GCM key derived by HKDF from AGENT_SETTINGS_SECRET
// (or the session secret). No restaurant data is ever sent by the connection check.

export interface AgentSettings {
  readonly agentApiKey: string;
  readonly agentBaseUrl: string;
  readonly agentModel: string;
}

const PURPOSE = new TextEncoder().encode('japan-atlas/owner-agent-settings/v1');
const ALLOWED_BASES = new Set([
  'https://api.deepseek.com',
  'https://api.deepseek.com/v1',
  'https://api.openai.com/v1',
]);
const DEFAULTS = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };

export function validateAgentBaseUrl(value: string): string {
  const base = value.trim().replace(/\/$/u, '');
  if (!ALLOWED_BASES.has(base))
    throw new HttpError(
      400,
      'Use https://api.deepseek.com or https://api.openai.com/v1. Other providers are not enabled yet.',
    );
  return base;
}

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const secretOf = (env: Env) => env.AGENT_SETTINGS_SECRET ?? env.ATLAS_OWNER_SESSION_SECRET;

async function key(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || secret.length < 32)
    throw new HttpError(503, 'Server credential encryption is not configured.');
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: PURPOSE, info: PURPOSE },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function savedSettings(env: Env): Promise<AgentSettings | undefined> {
  const row = await env.DB.prepare(
    'SELECT ciphertext FROM owner_agent_settings WHERE singleton = 1',
  ).first<{ ciphertext: string }>();
  if (!row) return undefined;
  const { version, iv, ciphertext } = JSON.parse(row.ciphertext);
  if (version !== 1) throw new Error('Saved settings cannot be read.');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(iv), additionalData: PURPOSE },
    await key(secretOf(env)),
    decode(ciphertext),
  );
  const saved = JSON.parse(new TextDecoder().decode(plain)) as AgentSettings;
  validateAgentBaseUrl(saved.agentBaseUrl);
  return saved;
}

function deploymentSettings(env: Env): Partial<AgentSettings> {
  return {
    ...(env.AGENT_API_KEY ? { agentApiKey: env.AGENT_API_KEY } : {}),
    ...(env.AGENT_BASE_URL ? { agentBaseUrl: env.AGENT_BASE_URL } : {}),
    ...(env.AGENT_MODEL ? { agentModel: env.AGENT_MODEL } : {}),
  };
}

/** Owner-saved settings win; otherwise the deployment's AGENT_* variables. */
export async function resolveAgentSettings(env: Env): Promise<Partial<AgentSettings>> {
  return (await savedSettings(env)) ?? deploymentSettings(env);
}

export function completeSettings(settings: Partial<AgentSettings>): AgentSettings | undefined {
  const { agentApiKey, agentBaseUrl, agentModel } = settings;
  return agentApiKey && agentBaseUrl && agentModel
    ? { agentApiKey, agentBaseUrl, agentModel }
    : undefined;
}

export async function settingsStatus(env: Env): Promise<ModelSettingsStatus> {
  const saved = await savedSettings(env);
  const effective = saved ?? deploymentSettings(env);
  return {
    configured: Boolean(completeSettings(effective)),
    source: saved ? 'owner' : effective.agentApiKey ? 'deployment' : 'none',
    baseUrl: effective.agentBaseUrl ?? DEFAULTS.baseUrl,
    model: effective.agentModel ?? DEFAULTS.model,
    canSave: (secretOf(env)?.length ?? 0) >= 32,
  };
}

export async function saveSettings(
  env: Env,
  input: Record<string, unknown>,
  verify: (settings: AgentSettings) => Promise<void> = verifyAgentConnection,
): Promise<ModelSettingsStatus> {
  if (
    typeof input.baseUrl !== 'string' ||
    typeof input.model !== 'string' ||
    typeof input.apiKey !== 'string'
  )
    throw new HttpError(400, 'Provide a base URL, model and API key.');
  const baseUrl = validateAgentBaseUrl(input.baseUrl);
  const model = input.model.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u.test(model))
    throw new HttpError(400, 'Provide a valid model identifier.');
  let apiKey = input.apiKey.trim();
  if (!apiKey) {
    const current = await resolveAgentSettings(env);
    if (current.agentBaseUrl?.replace(/\/$/u, '') !== baseUrl || !current.agentApiKey)
      throw new HttpError(400, 'Enter a new API key when changing providers.');
    apiKey = current.agentApiKey;
  }
  if (apiKey.length < 8 || apiKey.length > 4096 || /\s/u.test(apiKey))
    throw new HttpError(400, 'Provide a valid API key.');
  const settings = { agentApiKey: apiKey, agentBaseUrl: baseUrl, agentModel: model };
  const encryptionKey = await key(secretOf(env));
  await verify(settings);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: PURPOSE },
    encryptionKey,
    new TextEncoder().encode(JSON.stringify(settings)),
  );
  const envelope = JSON.stringify({
    version: 1,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  });
  await env.DB.prepare(
    'INSERT INTO owner_agent_settings (singleton, ciphertext) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET ciphertext = excluded.ciphertext',
  )
    .bind(envelope)
    .run();
  return settingsStatus(env);
}

export async function removeSettings(env: Env): Promise<ModelSettingsStatus> {
  await env.DB.prepare('DELETE FROM owner_agent_settings WHERE singleton = 1').run();
  return settingsStatus(env);
}

/** A bounded tool call checks this exact key/model pair; the research agent needs tool calls. */
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
      ...(baseUrl.startsWith('https://api.deepseek.com') ? { reasoning_effort: 'none' } : {}),
      messages: [{ role: 'user', content: 'Call the connection_check tool with empty arguments.' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'connection_check',
            description: 'A no-op connection check.',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'connection_check' } },
    }),
  }).catch(() => {
    throw new HttpError(
      502,
      'The model endpoint could not be reached from this server within 15 seconds.',
    );
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(
      502,
      `The model provider returned HTTP ${response.status}. Check API key, model access and credit.`,
    );
  }
  let calls: unknown;
  try {
    calls = JSON.parse(await readBoundedText(response, 16_384))?.choices?.[0]?.message?.tool_calls;
  } catch {
    calls = undefined;
  }
  if (
    !Array.isArray(calls) ||
    calls.length !== 1 ||
    calls[0]?.function?.name !== 'connection_check'
  )
    throw new HttpError(502, 'This model did not support the required tool call.');
}
