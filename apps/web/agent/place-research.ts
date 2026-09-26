import {
  validateWebResearchOutput,
  type WebResearchPort,
} from '../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { createWebSearch, type SearchEvidence } from './web-search.ts';
import {
  restaurantResearchPrompt,
  restaurantSearchDescription,
  isTabelogRestaurantListing,
} from './research-instructions.ts';

export interface AgentConfiguration {
  apiKey: string;
  baseUrl: string;
  model: string;
  searchApiKey?: string;
  fetch?: typeof fetch;
}

type Evidence = SearchEvidence;
export function createConfiguredPlaceResearchAgent(options: {
  agentApiKey?: string;
  agentBaseUrl?: string;
  agentModel?: string;
  searchApiKey?: string;
  fetch?: typeof fetch;
}): WebResearchPort | undefined {
  if (
    !options.agentApiKey &&
    !options.agentBaseUrl &&
    !options.agentModel &&
    !options.searchApiKey
  )
    return undefined;
  if (!options.agentApiKey || !options.agentBaseUrl || !options.agentModel)
    return {
      async research() {
        return { kind: 'unavailable' };
      },
    };
  try {
    return createPlaceResearchAgent({
      apiKey: options.agentApiKey,
      baseUrl: options.agentBaseUrl,
      model: options.agentModel,
      ...(options.searchApiKey ? { searchApiKey: options.searchApiKey } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  } catch {
    return {
      async research() {
        return { kind: 'unavailable' };
      },
    };
  }
}

/** One bounded, read-only research run; persistence stays in the intake coordinator. */
export function createPlaceResearchAgent(
  config: AgentConfiguration,
): WebResearchPort {
  const base = new URL(config.baseUrl.replace(/\/$/, '') + '/');
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !config.apiKey ||
    !config.model
  ) {
    throw new TypeError('Agent requires an HTTPS base URL, model and API key.');
  }
  const endpoint = new URL('chat/completions', base).href;
  const fetcher = config.fetch ?? fetch;
  const searchProvider = createWebSearch({
    ...(config.searchApiKey ? { apiKey: config.searchApiKey } : {}),
    fetch: fetcher,
  });
  return {
    async research(input) {
      if (!('selectedSubject' in input)) return { kind: 'unavailable' };
      const signal = AbortSignal.timeout(35_000);
      const evidence: Evidence[] = [];
      const messages: Record<string, unknown>[] = [
        { role: 'system', content: restaurantResearchPrompt },
        { role: 'user', content: JSON.stringify(input.selectedSubject) },
      ];
      let searches = 0;
      const usedCallIds = new Set<string>();
      try {
        for (let step = 0; step < 3; step++) {
          const response = await fetcher(endpoint, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              temperature: 0,
              max_tokens: 1200,
              messages,
              ...(searches < 2
                ? {
                    tools: [
                      {
                        type: 'function',
                        function: {
                          name: 'search_web',
                          description: restaurantSearchDescription,
                          parameters: {
                            type: 'object',
                            properties: { query: { type: 'string' } },
                            required: ['query'],
                            additionalProperties: false,
                          },
                        },
                      },
                    ],
                    tool_choice: 'auto',
                  }
                : { response_format: { type: 'json_object' } }),
            }),
          });
          const modelResult = await readJson(response, 32_768);
          const message = modelResult?.choices?.[0]?.message;
          if (!message || typeof message !== 'object')
            return { kind: 'unavailable' };
          if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
            if (message.tool_calls.length > 2 - searches)
              return { kind: 'unavailable' };
            const batch: { id: string; query: string }[] = [];
            // Validate the whole batch before executing any external search.
            for (const call of message.tool_calls) {
              if (
                call?.function?.name !== 'search_web' ||
                typeof call.id !== 'string' ||
                !call.id ||
                usedCallIds.has(call.id) ||
                batch.some((item) => item.id === call.id)
              )
                return { kind: 'unavailable' };
              const args = JSON.parse(call.function.arguments);
              if (
                typeof args?.query !== 'string' ||
                !args.query.trim() ||
                args.query.length > 500
              )
                return { kind: 'unavailable' };
              batch.push({ id: call.id, query: args.query });
            }
            messages.push({
              role: 'assistant',
              content: message.content ?? null,
              tool_calls: message.tool_calls,
            });
            for (const call of batch) {
              usedCallIds.add(call.id);
              searches++;
              const result = await searchProvider.search(call.query, signal);
              if (result.kind !== 'results') return { kind: 'unavailable' };
              evidence.push(...result.sources);
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result.sources),
              });
            }
            continue;
          }
          if (typeof message.content !== 'string' || searches === 0)
            return { kind: 'unavailable' };
          const proposal = JSON.parse(message.content);
          const unknown = { status: 'unknown' as const };
          if (proposal.subjectMatch !== 'matched')
            return {
              kind: 'observed',
              value: { tabelog: unknown, reservation: unknown },
            };
          const observedAt = new Date().toISOString();
          const fact = (field: 'tabelog' | 'reservation') => {
            const value = proposal[field];
            const quote = proposal.evidence?.[field];
            const identityQuote =
              typeof quote?.identityQuote === 'string'
                ? { url: quote.url, quote: quote.identityQuote }
                : proposal.evidence?.identity;
            const identity =
              supported(identityQuote, evidence) &&
              matchesSelectedBranch(
                identityQuote.quote,
                input.selectedSubject.transientName,
                input.selectedSubject.transientAddress,
                input.selectedSubject.ownerQuery,
              );
            if (
              !identity ||
              value?.status !== 'known' ||
              value.url !== identityQuote.url ||
              quote?.url !== value.url ||
              !supported(quote, evidence)
            )
              return unknown;
            if (
              field === 'tabelog' &&
              (typeof value.url !== 'string' ||
                !isTabelogRestaurantListing(value.url) ||
                typeof value.score !== 'number' ||
                !numericToken(quote.quote, value.score))
            )
              return unknown;
            return {
              ...value,
              provenance: 'agent_observed',
              observedAt,
              freshness: 'fresh',
            };
          };
          const value = validateWebResearchOutput(
            { tabelog: fact('tabelog'), reservation: fact('reservation') },
            { tabelog: unknown, reservation: unknown },
          );
          return value ? { kind: 'observed', value } : { kind: 'unavailable' };
        }
      } catch {
        return { kind: 'unavailable' };
      }
      return { kind: 'unavailable' };
    },
  };
}

function supported(value: unknown, sources: Evidence[]): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.quote === 'string' &&
    record.quote.length >= 4 &&
    sources.some(
      (source) =>
        source.url === record.url &&
        source.content.includes(record.quote as string),
    )
  );
}

function matchesSelectedBranch(
  quote: string,
  name: string,
  address: string,
  ownerQuery: string,
): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{Z}\s]/gu, '');
  const text = normalize(quote);
  const selectedName = normalize(name);
  const selectedAddress = normalize(address);
  const aliases = [selectedName, ...ownerQuery.split(/\s+/u).map(normalize)];
  const nameMatches = aliases.some(
    (alias) => alias.length >= 4 && text.includes(alias),
  );
  if (!nameMatches) return false;
  if (selectedAddress.length >= 8 && text.includes(selectedAddress))
    return true;
  // Street/block numbers survive Japanese/English address formatting, unlike city names.
  // A name match alone is insufficient for chains; ambiguous address evidence stays unknown.
  const streetNumbers = (value: string): string[] =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/ch[ōo]me|丁目|番地|番|号/gu, '-')
      .replace(/[\s‐‑‒–—−ー]/gu, '-')
      .replace(/-+/gu, '-')
      .match(/\d{1,4}-\d{1,4}-\d{1,4}/gu) ?? [];
  const selectedNumbers = streetNumbers(address);
  return selectedNumbers.some((numbers) =>
    streetNumbers(quote).includes(numbers),
  );
}

function numericToken(quote: string, score: number): boolean {
  return (quote.match(/\d+(?:\.\d+)?/gu) ?? []).some(
    (value) => Number(value) === score,
  );
}

// Bodies are streamed under a byte limit, including providers ignoring max_tokens.
type ProviderResponse = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: {
        id: string;
        function: { name: string; arguments: string };
      }[];
    };
  }[];
  results?: Record<string, unknown>[];
};
async function readJson(
  response: Response,
  maximum: number,
): Promise<ProviderResponse> {
  if (!response.ok || !response.body) throw new Error('Provider unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new Error('Provider response too large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}
