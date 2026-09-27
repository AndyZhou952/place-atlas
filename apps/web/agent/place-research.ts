import {
  validateWebResearchOutput,
  validateEnrichedProfile,
  type WebResearchPort,
} from '../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { composeRestaurantSummary } from '../product/application/catalog-intake/restaurant-profile-presentation.ts';
import { createWebSearch, type SearchEvidence } from './web-search.ts';
import type { RestaurantSourceReader } from './browser-source-reader.ts';
import {
  readTabelogListingResult,
  type TabelogEvidence,
} from './tabelog-listing.ts';
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
  readSourcePages?: boolean;
  sourceReader?: RestaurantSourceReader;
}

type Evidence = SearchEvidence;
export function createConfiguredPlaceResearchAgent(options: {
  agentApiKey?: string;
  agentBaseUrl?: string;
  agentModel?: string;
  searchApiKey?: string;
  sourceReader?: RestaurantSourceReader;
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
      ...(options.sourceReader ? { sourceReader: options.sourceReader } : {}),
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
      const evidence: TabelogEvidence[] = [];
      const messages: Record<string, unknown>[] = [
        { role: 'system', content: restaurantResearchPrompt },
        { role: 'user', content: JSON.stringify(input.selectedSubject) },
      ];
      let searches = 0;
      let successfulSearches = 0;
      const readUrls = new Set<string>();
      const usedCallIds = new Set<string>();
      let sourceAccessIssue: 'blocked' | 'unavailable' | undefined;
      const readListing = async (url: string) => {
        const result = config.sourceReader
          ? await config.sourceReader(url, signal)
          : await readTabelogListingResult(url, fetcher, signal);
        if (result.kind === 'read') return result.evidence;
        if (result.kind === 'blocked') sourceAccessIssue = 'blocked';
        else sourceAccessIssue ??= 'unavailable';
        return undefined;
      };
      const readSelectedListing = async (sources: SearchEvidence[]) => {
        // Search order is not branch identity. Prefer corroborated address/name
        // snippets and try another listing after a wrong branch or failed read.
        const subject = input.selectedSubject;
        const matches = (text: string) =>
          matchesSelectedBranch(
            text,
            subject.transientName,
            subject.transientAddress,
            subject.ownerQuery,
          );
        const ranked = [...sources].sort(
          (a, b) =>
            Number(matches(`${b.title} ${b.content}`)) -
            Number(matches(`${a.title} ${a.content}`)),
        );
        for (const source of ranked) {
          if (readUrls.size >= 3) break;
          const url = canonicalListingUrl(source.url);
          if (!url || readUrls.has(url)) continue;
          readUrls.add(url);
          const page = await readListing(url);
          if (!page) continue;
          sources.unshift(page);
          if (
            page.restaurant &&
            matchesSelectedBranch(
              `${page.restaurant.name} ${page.restaurant.address}`,
              subject.transientName,
              subject.transientAddress,
              subject.ownerQuery,
              page.restaurant.address,
            )
          )
            break;
        }
      };
      try {
        const selectedListing =
          input.selectedSubject.providerNamespace === 'tabelog'
            ? input.selectedSubject.placeId
            : input.selectedSubject.ownerQuery.match(
                /https:\/\/tabelog\.com\/[^\s]+/u,
              )?.[0];
        if (
          selectedListing &&
          isTabelogRestaurantListing(selectedListing) &&
          config.readSourcePages !== false
        ) {
          const page = await readListing(selectedListing);
          readUrls.add(selectedListing);
          if (page) {
            evidence.push(page);
            successfulSearches++;
            messages.push({
              role: 'user',
              content: JSON.stringify({
                discoveredSource: page,
                instruction:
                  'This source was read by the application. Extract supported facts; search only for missing details.',
              }),
            });
          }
        }
        // Anchor discovery in the provider's selected name before the model can
        // mistranslate a neighborhood or spend both searches on irrelevant pages.
        // This consumes the same two-search budget, never an extra hidden retry.
        if (!selectedListing && config.readSourcePages !== false) {
          searches++;
          const query = `${input.selectedSubject.transientName.slice(0, 450)} site:tabelog.com`;
          const result = await searchProvider.search(query, signal);
          if (result.kind === 'results') {
            successfulSearches++;
            await readSelectedListing(result.sources);
            evidence.push(...result.sources);
          }
          messages.push({
            role: 'user',
            content: JSON.stringify({
              applicationSearch: query,
              sources: result.kind === 'results' ? result.sources : result,
              remainingSearchCalls: 1,
              instruction:
                'Use these source facts only if their branch matches the selected address. One search remains for missing details or a corrected branch. Do not invent translations of the selected name or address.',
            }),
          });
        }
        for (let step = 0; step < 3; step++) {
          const response = await fetcher(endpoint, {
            method: 'POST',
            redirect: 'manual',
            signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              temperature: 0,
              max_tokens: 3000,
              ...(base.hostname === 'api.deepseek.com'
                ? { reasoning_effort: 'none' }
                : {}),
              messages,
              ...(searches < 2
                ? {
                    tools: [
                      {
                        type: 'function',
                        function: {
                          name: 'search_web',
                          description: `${restaurantSearchDescription} Remaining calls in this run: ${2 - searches}.`,
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
              if (result.kind === 'results') {
                successfulSearches++;
                if (config.readSourcePages !== false) {
                  await readSelectedListing(result.sources);
                }
                evidence.push(...result.sources);
              }
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(
                  result.kind === 'results' ? result.sources : result,
                ),
              });
            }
            continue;
          }
          if (typeof message.content !== 'string' || successfulSearches === 0)
            return { kind: 'unavailable' };
          const proposal = JSON.parse(message.content);
          const unknown = { status: 'unknown' as const };
          if (proposal.subjectMatch !== 'matched')
            return {
              kind: 'observed',
              value: { tabelog: unknown, reservation: unknown },
              ...(sourceAccessIssue ? { sourceAccessIssue } : {}),
            };
          const observedAt = new Date().toISOString();
          const matchedListing = evidence.find(
            (source) =>
              source.restaurant &&
              (input.selectedSubject.providerNamespace === 'tabelog'
                ? source.url.replace(/\/$/u, '') ===
                  input.selectedSubject.placeId.replace(/\/$/u, '')
                : matchesSelectedBranch(
                    `${source.restaurant.name} ${source.restaurant.address}`,
                    input.selectedSubject.transientName,
                    input.selectedSubject.transientAddress,
                    input.selectedSubject.ownerQuery,
                    source.restaurant.address,
                  )),
          );
          const fact = (
            field: 'tabelog' | 'reservation',
          ): Record<string, unknown> => {
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
              field === 'reservation' &&
              ![
                'reservable',
                'reservation_required',
                'not_reservable',
              ].includes(value.mode)
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
            const allowed =
              field === 'tabelog'
                ? ['status', 'score', 'reviewCount', 'url']
                : [
                    'status',
                    'mode',
                    'label',
                    'advanceDays',
                    'bookingWindowLabel',
                    'releaseNote',
                    'channel',
                    'url',
                  ];
            return {
              ...Object.fromEntries(
                allowed
                  .filter((key) => value[key] !== undefined)
                  .map((key) => [key, value[key]]),
              ),
              provenance: 'agent_observed',
              observedAt,
              freshness: 'fresh',
            };
          };
          const profile: Record<string, unknown> = {};
          for (const field of [
            'name',
            'area',
            'address',
            'categories',
            'signatureDishes',
            'officialWebsite',
            'bookingLink',
            'googleRating',
          ]) {
            const claim = proposal.profile?.[field];
            const proof =
              proposal.evidence?.[field] ?? proposal.profile?.evidence?.[field];
            // A parsed listing already passed the selected-branch check. Do not
            // discard a quoted dish merely because the model omitted a redundant
            // identity quote; this exemption never applies to another source.
            const verifiedListingProof =
              matchedListing && proof?.url === matchedListing.url;
            if (
              claim === undefined ||
              !supported(proof, evidence) ||
              (!verifiedListingProof &&
                (typeof proof?.identityQuote !== 'string' ||
                  !supported(
                    { url: proof.url, quote: proof.identityQuote },
                    evidence,
                  ) ||
                  !matchesSelectedBranch(
                    proof.identityQuote,
                    input.selectedSubject.transientName,
                    input.selectedSubject.transientAddress,
                    input.selectedSubject.ownerQuery,
                  )))
            )
              continue;
            // Exact factual values must occur in evidence; only a description may paraphrase.
            if (field === 'signatureDishes' && Array.isArray(claim)) {
              // Japanese source typography often quotes just the ingredient name:
              // 「六白黒豚」のとんかつ. Ignore typography, not words, and retain
              // supported entries even when a different proposed dish is invented.
              const normalizeDish = (value: string) =>
                value.normalize('NFKC').replace(/[「」『』“”"\s]/gu, '');
              const quote = normalizeDish(proof.quote);
              const dishes = [
                ...new Set(
                  claim.filter(
                    (dish: unknown): dish is string =>
                      typeof dish === 'string' &&
                      normalizeDish(dish).length >= 2 &&
                      quote.includes(normalizeDish(dish)),
                  ),
                ),
              ].slice(0, 5);
              if (dishes.length)
                profile[field] = {
                  value: dishes,
                  sourceUrl: proof.url,
                  observedAt,
                };
              continue;
            }
            const tokens = Array.isArray(claim)
              ? claim
              : field === 'googleRating' && claim && typeof claim === 'object'
                ? [
                    claim.score,
                    ...(claim.reviewCount === undefined
                      ? []
                      : [claim.reviewCount]),
                  ]
                : [claim];
            if (
              !tokens.every((token: unknown) =>
                typeof token === 'number'
                  ? numericToken(proof.quote, token)
                  : typeof token === 'string' && proof.quote.includes(token),
              )
            )
              continue;
            profile[field] = { value: claim, sourceUrl: proof.url, observedAt };
          }
          let reservation = fact('reservation');
          let tabelog = fact('tabelog');
          if (matchedListing?.restaurant) {
            const details = matchedListing.restaurant;
            const sourceUrl = matchedListing.url;
            for (const field of [
              'name',
              'address',
              'area',
              'coordinates',
              'categories',
              'officialWebsite',
            ] as const) {
              const value = details[field];
              if (
                value !== undefined &&
                (!Array.isArray(value) || value.length)
              )
                profile[field] = { value, sourceUrl, observedAt };
            }
            tabelog = {
              status: 'known',
              score: details.score,
              url: sourceUrl,
              provenance: 'agent_observed',
              observedAt,
              freshness: 'fresh',
            };
            // Absence of a policy is unknown, never "known/not_stated". An explicit
            // refusal is a policy but says nothing about seats, queues or opening now.
            const policy = details.reservation;
            if (reservation.status === 'unknown' && policy) {
              const mode = /予約不可/u.test(policy)
                ? 'not_reservable'
                : /完全予約制|予約必須|要予約/u.test(policy)
                  ? 'reservation_required'
                  : /予約可/u.test(policy)
                    ? 'reservable'
                    : undefined;
              if (mode)
                reservation = {
                  status: 'known',
                  mode,
                  label: policy.slice(0, 500),
                  url: sourceUrl,
                  provenance: 'agent_observed',
                  observedAt,
                  freshness: 'fresh',
                };
            }
          }
          for (const key of Object.keys(profile)) {
            if (!validateEnrichedProfile({ [key]: profile[key] }))
              delete profile[key];
          }
          const checkedProfile = validateEnrichedProfile(profile);
          if (checkedProfile) {
            // Constrain prose to validated facts rather than trusting a citation as
            // proof for arbitrary model-generated claims (awards, popularity, etc.).
            const summary = composeRestaurantSummary({
              categories: checkedProfile.categories?.value,
              dishes: checkedProfile.signatureDishes?.value,
              area: checkedProfile.area?.value,
            });
            const summarySource =
              checkedProfile.categories ??
              checkedProfile.signatureDishes ??
              checkedProfile.area;
            if (summary && summarySource) {
              profile.summary = {
                value: summary,
                sourceUrl: summarySource.sourceUrl,
                observedAt,
              };
            }
          }
          const value = validateWebResearchOutput(
            {
              tabelog,
              reservation,
              ...(Object.keys(profile).length ? { profile } : {}),
            },
            { tabelog: unknown, reservation: unknown },
          );
          return value
            ? {
                kind: 'observed',
                value,
                ...(sourceAccessIssue ? { sourceAccessIssue } : {}),
              }
            : { kind: 'unavailable' };
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

function canonicalListingUrl(value: string): string | undefined {
  if (!isTabelogRestaurantListing(value)) return undefined;
  const url = new URL(value);
  url.pathname = url.pathname.replace(/^\/(?:en|tw|cn|kr)\//u, '/');
  url.search = '';
  url.hash = '';
  return url.href;
}

function matchesSelectedBranch(
  quote: string,
  name: string,
  address: string,
  ownerQuery: string,
  sourceAddress?: string,
): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{Z}\s]/gu, '');
  const text = normalize(quote);
  const selectedName = normalize(name);
  const selectedAddress = normalize(address);
  const addressText = sourceAddress ? normalize(sourceAddress) : text;
  const aliases = ownerQuery.split(/\s+/u).map(normalize);
  const nameMatches =
    (selectedName.length >= 2 && text.includes(selectedName)) ||
    aliases.some(
      (alias) =>
        (alias.length >= 4 ||
          (alias.length >= 3 && /\p{Script=Han}/u.test(alias))) &&
        !/\d/u.test(alias) &&
        text.includes(alias),
    );
  if (!nameMatches) return false;
  if (selectedAddress.length >= 8 && addressText.includes(selectedAddress))
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
  if (
    !selectedNumbers.some((numbers) =>
      streetNumbers(sourceAddress ?? quote).includes(numbers),
    )
  )
    return false;
  const locality =
    address.normalize('NFKC').match(/[\p{Script=Han}ぁ-んァ-ヶ]+[区市郡]/gu) ??
    [];
  if (locality.length)
    return locality.some((part) => addressText.includes(normalize(part)));
  // Common bilingual ward/neighborhood aliases are corroboration, never identity
  // by themselves. Unmapped addresses stay unknown rather than matching numbers alone.
  const aliasesByLocality: Record<string, string> = {
    shinjuku: '新宿',
    nishishinjuku: '西新宿',
    ikebukuro: '池袋',
    toshima: '豊島',
    minato: '港区',
    shibuya: '渋谷',
    bunkyo: '文京',
    koto: '江東',
    sumida: '墨田',
    taito: '台東',
    chiyoda: '千代田',
    setagaya: '世田谷',
    suginami: '杉並',
    meguro: '目黒',
    shinagawa: '品川',
    ginza: '銀座',
    azabujuban: '麻布十番',
  };
  const latinAddress = address
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/gu, '');
  return Object.entries(aliasesByLocality).some(
    ([latin, japanese]) =>
      latinAddress.includes(latin) && addressText.includes(normalize(japanese)),
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
