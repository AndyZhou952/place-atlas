import { readBoundedText } from '../http.ts';

export interface ModelConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
}

/**
 * One OpenAI-compatible chat completion that must return a JSON object.
 * Source text is passed as user data; the system prompt carries the instructions.
 */
export async function chatJson(
  config: ModelConfig,
  system: string,
  user: string,
  maxTokens = 1200,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const response = await fetcher(`${config.baseUrl.replace(/\/$/u, '')}/chat/completions`, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
      // DeepSeek reasoning is unnecessary for extraction and would consume the token budget.
      ...(config.baseUrl.includes('api.deepseek.com') ? { reasoning_effort: 'none' } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Model provider returned HTTP ${response.status}`);
  }
  const body = JSON.parse(await readBoundedText(response, 256_000));
  const content: unknown = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Model returned no content');
  const parsed: unknown = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/gu, ''));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Model returned no object');
  return parsed as Record<string, unknown>;
}
