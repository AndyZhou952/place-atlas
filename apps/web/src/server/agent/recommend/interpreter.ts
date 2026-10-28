import type { RecommendConversationInput } from '../../../shared/recommend-conversation.ts';
import type { RecommendOriginOption } from './intent.ts';
import type { RecommendInterpreter } from './service.ts';
import { validateAgentBaseUrl, type AgentSettings } from '../../settings.ts';

const prompt = `Interpret a restaurant recommendation request over the owner's saved catalog. Return one JSON object with action (recommend, clarify, unsupported), originId (an option ID or null), originText (exact user-provided station, address or shop name when absent from options), originKind (area, station, address or place), foodTerms and excludedFoodTerms (arrays of short cuisine or dish names, using ramen, sushi, curry, yakitori, beef_tongue or coffee for those foods and otherwise the user's words or the English cuisine name, e.g. French, Italian, 焼肉; empty when no food is requested), travelMode (none, walk, transit or either), maxMinutes (number or null), visited (prefer_unvisited, only_unvisited, only_visited or any), and question/clarification when needed. Default visited to prefer_unvisited. The replies are answers to prior clarification questions and may correct the origin. A broad area alone permits area recommendations without a route duration. Without an explicit travel mode, use travelMode none and maxMinutes null; for 'near me', ask for the starting point if missing and use straight-line distance after it is resolved. Never assume walking or train. A timed route from a broad area needs an exact starting point. A pasted shop name alone is an origin hint, not a restaurant to recommend; ask which branch if ambiguous. Food-only requests need no origin unless the user asks for proximity or a timed route. Do not invent option IDs, addresses, restaurants, scores, routes or travel time. Never treat a source outage as an empty catalog.`;

export function createRecommendInterpreter(
  settings: AgentSettings,
  fetcher: typeof fetch = fetch,
): RecommendInterpreter {
  const baseUrl = validateAgentBaseUrl(settings.agentBaseUrl);
  return {
    async interpret(
      input: RecommendConversationInput,
      options: readonly RecommendOriginOption[],
    ): Promise<unknown> {
      const response = await fetcher(`${baseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.agentApiKey}`,
        },
        body: JSON.stringify({
          model: settings.agentModel,
          temperature: 0,
          max_tokens: 700,
          response_format: { type: 'json_object' },
          ...(baseUrl.startsWith('https://api.deepseek.com') ? { reasoning_effort: 'none' } : {}),
          messages: [
            { role: 'system', content: prompt },
            {
              role: 'user',
              content: JSON.stringify({
                query: input.query,
                replies: input.replies,
                originOptions: options,
              }),
            },
          ],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Recommend model unavailable');
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (contentLength > 65_536) throw new Error('Recommend model response too large');
      const body = await response.text();
      if (body.length > 65_536) throw new Error('Recommend model response too large');
      const envelope: unknown = JSON.parse(body);
      if (!envelope || typeof envelope !== 'object')
        throw new Error('Recommend model response invalid');
      const choices = (envelope as Record<string, unknown>).choices;
      const choice = Array.isArray(choices) ? choices[0] : undefined;
      if (!choice || choice.finish_reason !== 'stop')
        throw new Error('Recommend model response incomplete');
      const content = choice.message?.content;
      if (typeof content !== 'string' || content.length > 32_768)
        throw new Error('Recommend model answer invalid');
      return JSON.parse(content);
    },
  };
}
