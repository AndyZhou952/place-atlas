import type { ModelSettingsStatus } from '../shared/types.ts';
import type { Env } from './env.ts';
import { HttpError } from './http.ts';
import { type ModelConfig, chatJson } from './agent/llm.ts';

// Encrypted envelope (unchanged since 0.1): {version:1, iv, ciphertext} with an AES-GCM key
// derived by HKDF from AGENT_SETTINGS_SECRET (or the session secret).
const PURPOSE = new TextEncoder().encode('japan-atlas/owner-agent-settings/v1');
const ALLOWED_BASES = [
  'https://api.deepseek.com',
  'https://api.deepseek.com/v1',
  'https://api.openai.com/v1',
];
const DEFAULTS = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };

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

async function savedConfig(env: Env): Promise<ModelConfig | undefined> {
  const row = await env.DB.prepare(
    'SELECT ciphertext FROM owner_agent_settings WHERE singleton = 1',
  ).first<{
    ciphertext: string;
  }>();
  if (!row) return undefined;
  const { iv, ciphertext } = JSON.parse(row.ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(iv), additionalData: PURPOSE },
    await key(secretOf(env)),
    decode(ciphertext),
  );
  const saved = JSON.parse(new TextDecoder().decode(plain));
  return { apiKey: saved.agentApiKey, baseUrl: saved.agentBaseUrl, model: saved.agentModel };
}

/** Owner-saved settings win; otherwise the deployment's AGENT_* variables. */
export async function modelConfig(env: Env): Promise<ModelConfig | undefined> {
  const saved = await savedConfig(env);
  if (saved) return saved;
  const { AGENT_API_KEY: apiKey, AGENT_BASE_URL: baseUrl, AGENT_MODEL: model } = env;
  return apiKey && baseUrl && model ? { apiKey, baseUrl, model } : undefined;
}

export async function settingsStatus(env: Env): Promise<ModelSettingsStatus> {
  const saved = await savedConfig(env);
  const config = saved ?? (await modelConfig(env));
  return {
    configured: Boolean(config),
    source: saved ? 'owner' : config ? 'deployment' : 'none',
    baseUrl: config?.baseUrl ?? DEFAULTS.baseUrl,
    model: config?.model ?? DEFAULTS.model,
    canSave: (secretOf(env)?.length ?? 0) >= 32,
  };
}

export async function saveSettings(
  env: Env,
  input: Record<string, unknown>,
): Promise<ModelSettingsStatus> {
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim().replace(/\/$/u, '') : '';
  const model = typeof input.model === 'string' ? input.model.trim() : '';
  let apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!ALLOWED_BASES.includes(baseUrl)) {
    throw new HttpError(400, 'Use https://api.deepseek.com or https://api.openai.com/v1.');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u.test(model))
    throw new HttpError(400, 'Provide a valid model identifier.');
  if (!apiKey) {
    const current = await modelConfig(env);
    if (current?.baseUrl.replace(/\/$/u, '') !== baseUrl)
      throw new HttpError(400, 'Enter a new API key when changing providers.');
    apiKey = current.apiKey;
  }
  if (apiKey.length < 8 || apiKey.length > 4096 || /\s/u.test(apiKey))
    throw new HttpError(400, 'Provide a valid API key.');
  const config = { apiKey, baseUrl, model };
  try {
    const check = await chatJson(
      config,
      'Reply with the JSON object {"ok":true}.',
      'connection check',
      128,
    );
    if (check.ok !== true) throw new Error('Unexpected reply');
  } catch {
    throw new HttpError(
      502,
      'The model did not answer the connection check. Check key, model access and credit.',
    );
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = JSON.stringify({ agentApiKey: apiKey, agentBaseUrl: baseUrl, agentModel: model });
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: PURPOSE },
    await key(secretOf(env)),
    new TextEncoder().encode(plain),
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
