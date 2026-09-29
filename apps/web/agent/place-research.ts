import {
  validateWebResearchOutput,
  validateEnrichedProfile,
  type WebResearchPort,
} from '../product/application/catalog-intake/catalog-intake-coordinator.ts';
import {
  compactRestaurantCategories,
  composeRestaurantSummary,
} from '../product/application/catalog-intake/restaurant-profile-presentation.ts';
import { researchRegion } from '../product/application/catalog/research-region.ts';
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
import { explicitReservationTiming } from './reservation-timing.ts';
import { readOfficialSite } from './official-site-reader.ts';
import {
  canonicalTableCheckBookingUrl,
  readTableCheckBookingPage,
  type TableCheckBookingEvidence,
} from './tablecheck-booking.ts';

export interface AgentConfiguration {
  apiKey: string;
  baseUrl: string;
  model: string;
  searchApiKey?: string;
  fetch?: typeof fetch;
  readSourcePages?: boolean;
  sourceReader?: RestaurantSourceReader;
  onDiagnostic?: (code: string) => void;
  officialWebsiteForPlaceId?: (placeId: string) => Promise<string | undefined>;
}

type Evidence = SearchEvidence;
export function createConfiguredPlaceResearchAgent(options: {
  agentApiKey?: string;
  agentBaseUrl?: string;
  agentModel?: string;
  searchApiKey?: string;
  sourceReader?: RestaurantSourceReader;
  onDiagnostic?: (code: string) => void;
  officialWebsiteForPlaceId?: (placeId: string) => Promise<string | undefined>;
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
      ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
      ...(options.officialWebsiteForPlaceId
        ? { officialWebsiteForPlaceId: options.officialWebsiteForPlaceId }
        : {}),
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
  const diagnostic = config.onDiagnostic ?? (() => {});
  return {
    async research(input) {
      if (!('selectedSubject' in input)) return { kind: 'unavailable' };
      const region = researchRegion(input.selectedSubject.transientAddress);
      const signal = AbortSignal.timeout(35_000);
      const evidence: TabelogEvidence[] = [];
      let bookingEvidence: TableCheckBookingEvidence | undefined;
      let officialCuisine:
        | { readonly category: string; readonly sourceUrl: string }
        | undefined;
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
              `${page.restaurant.name} ${page.restaurant.aliases?.join(' ') ?? ''} ${page.restaurant.address}`,
              subject.transientName,
              subject.transientAddress,
              subject.ownerQuery,
              page.restaurant.address,
              page.restaurant.postalCode,
              page.restaurant.name,
            )
          )
            break;
        }
      };
      const readSelectedBookingPage = async (sources: SearchEvidence[]) => {
        if (bookingEvidence) return;
        let candidates = 0;
        for (const [index, source] of sources.entries()) {
          const bookingUrl = canonicalTableCheckBookingUrl(source.url);
          if (!bookingUrl) continue;
          candidates++;
          const result = await readTableCheckBookingPage(
            bookingUrl,
            fetcher,
            signal,
          );
          diagnostic(`tablecheck_read_${result.kind}`);
          if (result.kind !== 'read') continue;
          const booking = result.evidence.booking;
          const selected = input.selectedSubject;
          const directBranch = booking.address
            ? matchesSelectedBranch(
                `${booking.name} ${booking.address}`,
                selected.transientName,
                selected.transientAddress,
                selected.ownerQuery,
                booking.address,
                undefined,
                booking.name,
              )
            : false;
          // Modern merchant pages omit their street address. Require the same
          // distinctive title and official website as a selected-branch listing.
          const modernBranch = [...sources, ...evidence].some((item) => {
            const listing = (item as TabelogEvidence).restaurant;
            if (!listing?.officialWebsite || !booking.officialWebsiteHost)
              return false;
            let officialHost: string;
            try {
              officialHost = new URL(listing.officialWebsite).hostname.replace(
                /^www\./u,
                '',
              );
            } catch {
              return false;
            }
            const normalizedName = (value: string) =>
              value
                .normalize('NFKC')
                .toLowerCase()
                .replace(/[\p{P}\p{Z}\s]/gu, '');
            return (
              normalizedName(booking.name).length >= 4 &&
              normalizedName(booking.name) === normalizedName(listing.name) &&
              officialHost === booking.officialWebsiteHost &&
              matchesSelectedBranch(
                `${listing.name} ${listing.aliases?.join(' ') ?? ''} ${listing.address}`,
                selected.transientName,
                selected.transientAddress,
                selected.ownerQuery,
                listing.address,
                listing.postalCode,
                listing.name,
              )
            );
          });
          if (!directBranch && !modernBranch) {
            diagnostic('tablecheck_branch_mismatch');
            continue;
          }
          diagnostic('tablecheck_branch_match');
          bookingEvidence = result.evidence;
          sources[index] = result.evidence;
          break;
        }
        if (!candidates) diagnostic('tablecheck_no_candidate');
      };
      const verifiedListingFallback = () => {
        const selected = input.selectedSubject;
        const listing = evidence.find(
          (source) =>
            source.restaurant &&
            (selected.providerNamespace === 'tabelog'
              ? source.url.replace(/\/$/u, '') ===
                selected.placeId.replace(/\/$/u, '')
              : matchesSelectedBranch(
                  `${source.restaurant.name} ${source.restaurant.aliases?.join(' ') ?? ''} ${source.restaurant.address}`,
                  selected.transientName,
                  selected.transientAddress,
                  selected.ownerQuery,
                  source.restaurant.address,
                  source.restaurant.postalCode,
                  source.restaurant.name,
                )),
        );
        if (!listing?.restaurant) return { kind: 'unavailable' as const };
        const details = listing.restaurant;
        const observedAt = new Date().toISOString();
        const profile: Record<string, unknown> = {};
        for (const field of [
          'name',
          'address',
          'area',
          'coordinates',
          'categories',
          'officialWebsite',
        ] as const) {
          const value = details[field];
          if (value !== undefined && (!Array.isArray(value) || value.length))
            profile[field] = {
              value,
              sourceUrl: listing.url,
              observedAt,
            };
        }
        for (const key of Object.keys(profile)) {
          if (!validateEnrichedProfile({ [key]: profile[key] }))
            delete profile[key];
        }
        const checkedProfile = validateEnrichedProfile(profile);
        const summary = composeRestaurantSummary({
          categories: checkedProfile?.categories?.value,
          area: checkedProfile?.area?.value,
        });
        if (summary && (checkedProfile?.categories || checkedProfile?.area))
          profile.summary = {
            value: summary,
            sourceUrl: listing.url,
            observedAt,
          };
        const policy = details.reservation;
        const mode = /予約不可/u.test(policy ?? '')
          ? 'not_reservable'
          : /完全予約制|予約必須|要予約/u.test(policy ?? '')
            ? 'reservation_required'
            : /予約可/u.test(policy ?? '')
              ? 'reservable'
              : undefined;
        const baseReservation =
          policy && mode
            ? {
                status: 'known' as const,
                mode,
                label: policy.slice(0, 500),
                ...(mode === 'not_reservable'
                  ? {}
                  : explicitReservationTiming(policy)),
                url: listing.url,
                provenance: 'agent_observed' as const,
                observedAt,
                freshness: 'fresh' as const,
              }
            : { status: 'unknown' as const };
        const reservation = bookingEvidence
          ? {
              status: 'known' as const,
              mode:
                baseReservation.status === 'known' &&
                baseReservation.mode !== 'not_reservable'
                  ? baseReservation.mode
                  : ('reservable' as const),
              label:
                baseReservation.status === 'known'
                  ? baseReservation.label
                  : '予約可',
              bookingWindowLabel: bookingEvidence.booking.bookingWindowLabel,
              ...(bookingEvidence.booking.advanceDays === undefined
                ? {}
                : { advanceDays: bookingEvidence.booking.advanceDays }),
              ...(bookingEvidence.booking.releaseNote
                ? { releaseNote: bookingEvidence.booking.releaseNote }
                : {}),
              url: bookingEvidence.url,
              provenance: 'agent_observed' as const,
              observedAt,
              freshness: 'fresh' as const,
            }
          : baseReservation;
        const tabelog =
          region === 'japan' && details.score !== undefined
            ? {
                status: 'known' as const,
                score: details.score,
                url: listing.url,
                provenance: 'agent_observed' as const,
                observedAt,
                freshness: 'fresh' as const,
              }
            : { status: 'unknown' as const };
        const value = validateWebResearchOutput(
          {
            tabelog,
            reservation,
            ...(Object.keys(profile).length ? { profile } : {}),
          },
          {
            tabelog: { status: 'unknown' },
            reservation: { status: 'unknown' },
          },
        );
        if (!value) return { kind: 'unavailable' as const };
        diagnostic('verified_listing_fallback');
        return {
          kind: 'observed' as const,
          value,
          ...(sourceAccessIssue ? { sourceAccessIssue } : {}),
        };
      };
      const recoverVerifiedListing = () => {
        try {
          return verifiedListingFallback();
        } catch {
          diagnostic('verified_listing_fallback_failed');
          return { kind: 'unavailable' as const };
        }
      };
      try {
        if (
          region === 'overseas' &&
          input.selectedSubject.providerNamespace === 'google-places' &&
          config.officialWebsiteForPlaceId &&
          config.readSourcePages !== false
        ) {
          const website = await config.officialWebsiteForPlaceId(
            input.selectedSubject.placeId,
          );
          const officialSources = website
            ? await readOfficialSite(website, signal, fetcher)
            : [];
          const branchSources = officialSources.filter((source) =>
            matchesSelectedBranch(
              source.content,
              input.selectedSubject.transientName,
              input.selectedSubject.transientAddress,
              input.selectedSubject.ownerQuery,
            ),
          );
          diagnostic(
            !officialSources.length
              ? 'official_site_unavailable'
              : branchSources.length
                ? 'official_site_read'
                : 'official_site_branch_mismatch',
          );
          if (branchSources.length) {
            officialCuisine = verifiedOfficialCuisine(
              officialSources,
              input.selectedSubject,
            );
            if (officialCuisine) diagnostic('official_cuisine_verified');
            successfulSearches++;
            // The exact branch already has direct pages. Do not let a model
            // spend the 35-second window on the blocked public search fallback.
            searches = 2;
            evidence.push(...officialSources);
            messages.push({
              role: 'user',
              content: JSON.stringify({
                discoveredOfficialSources: officialSources,
                instruction:
                  'The application read these public pages from the selected Place ID website. A contact page may identify the selected unit while a separately titled branch page describes its food. For cross-page facts, provide identityUrl as well as identityQuote, and quote the fact from the branch page. Never transfer bar or other-unit facts to the restaurant. The website hint itself is not evidence.',
              }),
            });
          }
        }
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
        if (
          !selectedListing &&
          successfulSearches === 0 &&
          config.readSourcePages !== false
        ) {
          searches++;
          const query = initialResearchQuery(input.selectedSubject);
          const result = await searchProvider.search(query, signal);
          diagnostic(
            `booking_search_${result.kind === 'results' ? 'results' : result.reason}`,
          );
          diagnostic(
            `initial_search_${result.kind === 'results' ? 'results' : result.reason}`,
          );
          if (result.kind === 'results') {
            successfulSearches++;
            await readSelectedListing(result.sources);
            await readSelectedBookingPage(result.sources);
            evidence.push(...result.sources);
          }
          messages.push({
            role: 'user',
            content: JSON.stringify({
              applicationSearch: query,
              sources: result.kind === 'results' ? result.sources : result,
              remainingSearchCalls: 1,
              instruction:
                'Use these source facts only if their branch matches the selected address. One search remains for missing details or a corrected branch. Do not invent translations of the selected name or address. Apply the selected country’s rating policy.',
            }),
          });
        }
        // A branch-matched listing can name its booking provider without
        // giving the booking URL. Spend the remaining search on that provider
        // so a generic model query cannot miss the primary booking rules.
        const bookingSearchListing = evidence.find(
          (source) =>
            (source.restaurant?.bookingProviderHint === 'tablecheck' ||
              (/完全予約制|予約必須|要予約/u.test(
                source.restaurant?.reservation ?? '',
              ) &&
                source.restaurant?.officialWebsite)) &&
            matchesSelectedBranch(
              `${source.restaurant.name} ${source.restaurant.aliases?.join(' ') ?? ''} ${source.restaurant.address}`,
              input.selectedSubject.transientName,
              input.selectedSubject.transientAddress,
              input.selectedSubject.ownerQuery,
              source.restaurant.address,
              source.restaurant.postalCode,
              source.restaurant.name,
            ),
        );
        if (
          bookingSearchListing?.restaurant &&
          !bookingEvidence &&
          searches < 2
        ) {
          searches++;
          // The listing already fixed the branch; adding its long address can
          // crowd the merchant page out of a three-result booking search.
          const query = `${bookingSearchListing.restaurant.name} TableCheck reservation 予約`;
          const result = await searchProvider.search(query, signal);
          if (result.kind === 'results') {
            successfulSearches++;
            await readSelectedBookingPage(result.sources);
            evidence.push(...result.sources);
          }
          messages.push({
            role: 'user',
            content: JSON.stringify({
              applicationSearch: query,
              sources: result.kind === 'results' ? result.sources : result,
              remainingSearchCalls: 0,
              instruction:
                'The selected listing confirms a reservation policy. Use only branch-matched, explicit booking rules; an unavailable page leaves timing unknown.',
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
          diagnostic(`model_http_${response.status}`);
          const modelResult = await readJson(response, 32_768);
          const message = modelResult?.choices?.[0]?.message;
          if (!message || typeof message !== 'object') {
            diagnostic('model_invalid_message');
            return recoverVerifiedListing();
          }
          if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
            if (message.tool_calls.length > 2 - searches)
              return recoverVerifiedListing();
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
                return recoverVerifiedListing();
              const args = JSON.parse(call.function.arguments);
              if (
                typeof args?.query !== 'string' ||
                !args.query.trim() ||
                args.query.length > 500
              )
                return recoverVerifiedListing();
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
                  await readSelectedBookingPage(result.sources);
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
          if (typeof message.content !== 'string' || successfulSearches === 0) {
            diagnostic(
              successfulSearches === 0
                ? 'no_successful_search'
                : 'model_missing_content',
            );
            return recoverVerifiedListing();
          }
          const proposal = JSON.parse(message.content);
          diagnostic(
            proposal.subjectMatch === 'matched'
              ? 'model_branch_matched'
              : 'model_branch_unmatched',
          );
          const unknown = { status: 'unknown' as const };
          const matchedListing = evidence.find(
            (source) =>
              source.restaurant &&
              (input.selectedSubject.providerNamespace === 'tabelog'
                ? source.url.replace(/\/$/u, '') ===
                  input.selectedSubject.placeId.replace(/\/$/u, '')
                : matchesSelectedBranch(
                    `${source.restaurant.name} ${source.restaurant.aliases?.join(' ') ?? ''} ${source.restaurant.address}`,
                    input.selectedSubject.transientName,
                    input.selectedSubject.transientAddress,
                    input.selectedSubject.ownerQuery,
                    source.restaurant.address,
                    source.restaurant.postalCode,
                    source.restaurant.name,
                  )),
          );
          // The parsed main listing has its own branch check. Do not discard
          // those independently verified facts because the model is uncertain.
          if (
            proposal.subjectMatch !== 'matched' &&
            !matchedListing &&
            !bookingEvidence &&
            !officialCuisine
          ) {
            diagnostic('branch_gate_closed');
            return {
              kind: 'observed',
              value: { tabelog: unknown, reservation: unknown },
              ...(sourceAccessIssue ? { sourceAccessIssue } : {}),
            };
          }
          const observedAt = new Date().toISOString();
          const fact = (
            field: 'tabelog' | 'reservation',
          ): Record<string, unknown> => {
            const value = proposal[field];
            const quote = proposal.evidence?.[field];
            const identityQuote =
              typeof quote?.identityQuote === 'string'
                ? {
                    url: quote.identityUrl ?? quote.url,
                    quote: quote.identityQuote,
                  }
                : proposal.evidence?.identity;
            const identity = supportedIdentity(
              quote,
              identityQuote,
              evidence,
              input.selectedSubject,
            );
            if (
              !identity ||
              value?.status !== 'known' ||
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
                : ['status', 'mode', 'label', 'releaseNote', 'channel', 'url'];
            const timing =
              field === 'reservation' && value.mode !== 'not_reservable'
                ? explicitReservationTiming(quote.quote)
                : {};
            return {
              ...Object.fromEntries(
                allowed
                  .filter(
                    (key) =>
                      value[key] !== undefined &&
                      (!['releaseNote', 'channel'].includes(key) ||
                        (typeof value[key] === 'string' &&
                          quote.quote.includes(value[key]))),
                  )
                  .map((key) => [key, value[key]]),
              ),
              ...timing,
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
            if (claim !== undefined)
              diagnostic(`model_claim_${field.toLowerCase()}`);
            // A parsed listing already passed the selected-branch check. Do not
            // discard a quoted dish merely because the model omitted a redundant
            // identity quote; this exemption never applies to another source.
            const verifiedListingProof =
              matchedListing && proof?.url === matchedListing.url;
            if (field === 'categories' && claim !== undefined) {
              diagnostic(
                !supported(proof, evidence)
                  ? 'category_rejected_source_quote'
                  : !verifiedListingProof &&
                      !supportedIdentity(
                        proof,
                        {
                          url: proof?.identityUrl ?? proof?.url,
                          quote: proof?.identityQuote,
                        },
                        evidence,
                        input.selectedSubject,
                      )
                    ? 'category_rejected_branch_identity'
                    : 'category_evidence_supported',
              );
            }
            if (
              claim === undefined ||
              !supported(proof, evidence) ||
              (field === 'googleRating' &&
                (region === 'mainland_china' ||
                  !isGoogleMapsRatingUrl(proof.url) ||
                  !/Google|rating|reviews?|評分|评分|評価/iu.test(
                    proof.quote,
                  ))) ||
              (!verifiedListingProof &&
                !supportedIdentity(
                  proof,
                  {
                    url: proof?.identityUrl ?? proof?.url,
                    quote: proof?.identityQuote,
                  },
                  evidence,
                  input.selectedSubject,
                ))
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
            if (field === 'categories' && Array.isArray(claim)) {
              const normalizeCategory = (value: string) =>
                value
                  .normalize('NFKC')
                  .toLowerCase()
                  .replace(/[\p{P}\p{Z}\s]/gu, '');
              const quote = normalizeCategory(proof.quote);
              const categories = compactRestaurantCategories(
                claim.filter(
                  (category: unknown): category is string =>
                    typeof category === 'string' &&
                    normalizeCategory(category).length >= 3 &&
                    quote.includes(normalizeCategory(category)),
                ),
              );
              if (categories.length)
                profile[field] = {
                  value: categories,
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
            ) {
              continue;
            }
            profile[field] = { value: claim, sourceUrl: proof.url, observedAt };
          }
          let reservation = fact('reservation');
          let tabelog = region === 'japan' ? fact('tabelog') : unknown;
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
            if (region === 'japan' && details.score !== undefined) {
              tabelog = {
                status: 'known',
                score: details.score,
                url: sourceUrl,
                provenance: 'agent_observed',
                observedAt,
                freshness: 'fresh',
              };
            }
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
                  ...(mode === 'not_reservable'
                    ? {}
                    : explicitReservationTiming(policy)),
                  url: sourceUrl,
                  provenance: 'agent_observed',
                  observedAt,
                  freshness: 'fresh',
                };
            }
          }
          if (bookingEvidence) {
            const corroboratedPolicy =
              reservation.status === 'known' &&
              reservation.mode !== 'not_reservable'
                ? reservation
                : undefined;
            reservation = {
              status: 'known',
              mode: corroboratedPolicy?.mode ?? 'reservable',
              label: corroboratedPolicy?.label ?? '予約可',
              bookingWindowLabel: bookingEvidence.booking.bookingWindowLabel,
              ...(bookingEvidence.booking.advanceDays === undefined
                ? {}
                : { advanceDays: bookingEvidence.booking.advanceDays }),
              ...(bookingEvidence.booking.releaseNote
                ? { releaseNote: bookingEvidence.booking.releaseNote }
                : {}),
              url: bookingEvidence.url,
              provenance: 'agent_observed',
              observedAt,
              freshness: 'fresh',
            };
          }
          if (officialCuisine) {
            const existing = profile.categories as
              | { value: readonly string[] }
              | undefined;
            profile.categories = {
              value: compactRestaurantCategories([
                officialCuisine.category,
                ...(existing?.value ?? []),
              ]),
              sourceUrl: officialCuisine.sourceUrl,
              observedAt,
            };
          }
          for (const key of Object.keys(profile)) {
            if (!validateEnrichedProfile({ [key]: profile[key] }))
              delete profile[key];
          }
          const checkedProfile = validateEnrichedProfile(profile);
          diagnostic(`profile_fields_${Object.keys(profile).length}`);
          for (const field of Object.keys(profile))
            diagnostic(`profile_accept_${field.toLowerCase()}`);
          diagnostic(
            reservation.status === 'known'
              ? 'reservation_known'
              : 'reservation_unknown',
          );
          if (
            region === 'overseas' &&
            reservation.status === 'unknown' &&
            checkedProfile?.bookingLink
          ) {
            const bookingLink = checkedProfile.bookingLink;
            const branchPage = evidence.find(
              (source) => source.url === bookingLink.sourceUrl,
            );
            if (
              branchPage &&
              [
                `Reserve Now: ${bookingLink.value}`,
                `Reservations: ${bookingLink.value}`,
                `Book a table: ${bookingLink.value}`,
                `Book Now: ${bookingLink.value}`,
              ].some((line) => branchPage.content.includes(line))
            ) {
              reservation = {
                status: 'known',
                mode: 'reservable',
                label: 'Reserve Now',
                ...explicitReservationTiming(branchPage.content),
                url: branchPage.url,
                provenance: 'agent_observed',
                observedAt,
                freshness: 'fresh',
              };
              diagnostic('reservation_official_link');
            }
          }
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
        diagnostic(signal.aborted ? 'deadline' : 'exception');
        return recoverVerifiedListing();
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

function supportedIdentity(
  proof: { url?: unknown } | undefined,
  identity: unknown,
  sources: Evidence[],
  subject: {
    transientName: string;
    transientAddress: string;
    ownerQuery: string;
  },
): boolean {
  if (
    !supported(identity, sources) ||
    !identity ||
    typeof identity !== 'object'
  )
    return false;
  const record = identity as { url: string; quote: string };
  if (
    !matchesSelectedBranch(
      record.quote,
      subject.transientName,
      subject.transientAddress,
      subject.ownerQuery,
    )
  )
    return false;
  if (record.url === proof?.url) return true;
  if (typeof proof?.url !== 'string') return false;
  const factSource = sources.find((source) => source.url === proof.url);
  if (!factSource) return false;
  try {
    if (new URL(record.url).origin !== new URL(proof.url).origin) return false;
  } catch {
    return false;
  }
  // A cross-page identity is safe only when the fact page is explicitly named
  // for that branch. A generic menu/reservations page can contain other units.
  const selectedName = branchKey(subject.transientName);
  const beforeStreet = record.quote.split(/(?<!\d)\d{1,4}\s+[A-Za-z]/u)[0];
  const label = branchKey(beforeStreet ?? '');
  return (
    label.includes(selectedName) &&
    label.length >= selectedName.length + 4 &&
    branchKey(factSource.title).includes(label) &&
    branchKey(factSource.content).includes(label)
  );
}

function branchKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '');
}

function canonicalListingUrl(value: string): string | undefined {
  if (!isTabelogRestaurantListing(value)) return undefined;
  const url = new URL(value);
  url.pathname = url.pathname.replace(/^\/(?:en|tw|cn|kr)\//u, '/');
  url.search = '';
  url.hash = '';
  return url.href;
}

export { researchRegion } from '../product/application/catalog/research-region.ts';

export function initialResearchQuery(subject: {
  readonly transientName: string;
  readonly transientAddress: string;
  readonly ownerQuery: string;
}): string {
  const name = subject.transientName.slice(0, 200).trim();
  const ownerHint = subject.ownerQuery.slice(0, 160).trim();
  const addressHint = subject.transientAddress
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ch[ōo]me|丁目|番地|番|号/gu, '-')
    .replace(/[\s‐‑‒–—−ー]/gu, '-')
    .replace(/-+/gu, '-')
    .match(/\d{1,4}-\d{1,4}-\d{1,4}/u)?.[0];
  const parts = [name];
  if (ownerHint && !name.toLowerCase().includes(ownerHint.toLowerCase())) {
    parts.push(ownerHint);
  }
  if (addressHint && !parts.some((part) => part.includes(addressHint))) {
    parts.push(addressHint);
  }
  const region = researchRegion(subject.transientAddress);
  if (region === 'japan') return `${parts.join(' ')} site:tabelog.com`;
  // The app can read Google rating by selected Place ID. Spend the limited
  // search budget on official branch facts that the Place ID cannot supply.
  return `${parts.join(' ')} official reservation`.trim();
}

function isGoogleMapsRatingUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ((url.hostname === 'maps.google.com' &&
        url.pathname.startsWith('/maps')) ||
        ((url.hostname === 'google.com' || url.hostname === 'www.google.com') &&
          url.pathname.startsWith('/maps')))
    );
  } catch {
    return false;
  }
}

/** Conservative official prose fallback when a model paraphrases cuisine. */
function verifiedOfficialCuisine(
  sources: SearchEvidence[],
  subject: {
    transientName: string;
    transientAddress: string;
    ownerQuery: string;
  },
): { category: string; sourceUrl: string } | undefined {
  for (const page of sources) {
    const cuisine =
      /\bserv(?:es|ing)\s+((?:[a-z-]+\s+){0,4}(?:barbecue|bbq|cuisine|sushi|ramen|coffee|pizza|pasta))\b/iu.exec(
        page.content,
      )?.[1];
    if (!cuisine) continue;
    for (const identity of sources) {
      if (identity.url === page.url) continue;
      let start = identity.content.indexOf(subject.transientName);
      for (let attempt = 0; start >= 0 && attempt < 12; attempt++) {
        const quote = identity.content.slice(start, start + 180);
        if (
          supportedIdentity(
            { url: page.url },
            { url: identity.url, quote },
            sources,
            subject,
          )
        )
          return { category: cuisine.trim(), sourceUrl: page.url };
        start = identity.content.indexOf(
          subject.transientName,
          start + subject.transientName.length,
        );
      }
    }
  }
  return undefined;
}

function matchesSelectedBranch(
  quote: string,
  name: string,
  address: string,
  ownerQuery: string,
  sourceAddress?: string,
  sourcePostalCode?: string,
  sourceName?: string,
): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      // A shop may write a common word in katakana on Google and hiragana
      // on Tabelog (牛タン / 牛たん). Keep the whole-name and address gates below.
      .replace(/[ァ-ヶ]/gu, (char) =>
        String.fromCharCode(char.charCodeAt(0) - 0x60),
      )
      .replace(/\brd\b/gu, 'road')
      .replace(/\bst\b/gu, 'street')
      .replace(/\bave\b/gu, 'avenue')
      .replace(/[\p{P}\p{Z}\s]/gu, '');
  const text = normalize(quote);
  const selectedName = normalize(name);
  const selectedAddress = normalize(address);
  const addressText = sourceAddress ? normalize(sourceAddress) : text;
  const aliases = ownerQuery
    .split(/\s+/u)
    .map(normalize)
    // A neighborhood in the query is location context, not proof that a
    // different business with that neighborhood in its name is the match.
    .filter((alias) => !sourceAddress || !addressText.includes(alias));
  const selectedOwnerName = normalize(ownerQuery);
  const listedName = sourceName ? normalize(sourceName) : '';
  const nameMatches =
    (selectedName.length >= 2 && text.includes(selectedName)) ||
    // A selected Google name can be romanized while the exact Japanese shop
    // name was supplied by the owner. Require the full listed name at the
    // start of that query; two-character fragments alone remain insufficient.
    (listedName.length >= 4 &&
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
        listedName,
      ) &&
      (selectedOwnerName.startsWith(listedName) ||
        // The owner may omit a suffix such as 西口店 while still supplying a
        // distinctive business name and area. Street and postcode must agree.
        (selectedOwnerName.length >= 5 &&
          listedName.startsWith(selectedOwnerName)))) ||
    aliases.some(
      (alias) =>
        ((alias.length >= 4 && /^[a-z]+$/u.test(alias)) ||
          (!sourceName &&
            alias.length >= 3 &&
            /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
              alias,
            ))) &&
        !/\d/u.test(alias) &&
        text.includes(alias),
    ) ||
    (aliases.length > 0 &&
      aliases.every(
        (alias) =>
          alias.length >= 3 &&
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
            alias,
          ) &&
          !/\d/u.test(alias) &&
          text.includes(alias),
      ));
  if (!nameMatches) return false;
  if (selectedAddress.length >= 8 && addressText.includes(selectedAddress))
    return true;
  // Street/block numbers survive Japanese/English address formatting, unlike city names.
  // A name match alone is insufficient for chains; ambiguous address evidence stays unknown.
  const streetNumbers = (value: string): string[] =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/gu, ' ')
      .replace(/ch[ōo]me|丁目|番地|番|号/gu, '-')
      .replace(/[\s‐‑‒–—−ー]/gu, '-')
      .replace(/-+/gu, '-')
      .match(/\d{1,4}-\d{1,4}(?:-\d{1,4})?/gu) ?? [];
  const selectedNumbers = streetNumbers(address);
  const sourceNumbers = streetNumbers(sourceAddress ?? quote);
  const matchingNumbers = selectedNumbers.filter((numbers) =>
    sourceNumbers.includes(numbers),
  );
  if (!matchingNumbers.length) return false;
  const selectedPostalCode = address
    .normalize('NFKC')
    .match(/(?<!\d)\d{3}[\s-]?\d{4}(?!\d)/u)?.[0]
    ?.replace(/\D/gu, '');
  // A two-part number is common in central Tokyo but less distinctive than a
  // three-part Japanese block address. Require the exact postal code too.
  if (
    matchingNumbers.every((numbers) => numbers.split('-').length === 2) &&
    (!selectedPostalCode || selectedPostalCode !== sourcePostalCode)
  )
    return false;
  if (selectedPostalCode && sourcePostalCode) {
    if (selectedPostalCode === sourcePostalCode) return true;
    // Google can report a building's dedicated postal code while a listing
    // uses the neighborhood code. Only override the mismatch when the same
    // street number, brand, and distinctive Japanese building name agree.
    const selectedBuildingNames =
      address.match(
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{6,}/gu,
      ) ?? [];
    if (
      !selectedBuildingNames.some((name) =>
        addressText.includes(normalize(name.replace(/[内階]+$/gu, ''))),
      )
    )
      return false;
  }
  // Common bilingual ward/neighborhood aliases are corroboration, never identity
  // by themselves. Unmapped addresses stay unknown rather than matching numbers alone.
  const aliasesByLocality: Record<string, string> = {
    // Google commonly renders Tokyo wards as English "City" while Japanese
    // listings use 区. Street number plus selected name are also required above.
    adachi: '足立区',
    arakawa: '荒川区',
    bunkyo: '文京区',
    chiyoda: '千代田区',
    chuo: '中央区',
    edogawa: '江戸川区',
    itabashi: '板橋区',
    katsushika: '葛飾区',
    kita: '北区',
    koto: '江東区',
    meguro: '目黒区',
    minato: '港区',
    nakano: '中野区',
    nerima: '練馬区',
    ota: '大田区',
    setagaya: '世田谷区',
    shibuya: '渋谷区',
    shinagawa: '品川区',
    shinjuku: '新宿区',
    suginami: '杉並区',
    sumida: '墨田区',
    taito: '台東区',
    toshima: '豊島区',
    nishishinjuku: '西新宿',
    ikebukuro: '池袋',
    ginza: '銀座',
    azabujuban: '麻布十番',
  };
  const latinAddress = address
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/gu, '');
  const selectedCity = address
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .match(/\b([a-z]+) city\b/u)?.[1];
  if (
    selectedCity &&
    aliasesByLocality[selectedCity] &&
    !addressText.includes(normalize(aliasesByLocality[selectedCity])) &&
    !addressText.includes(`${selectedCity}ku`) &&
    !addressText.includes(`${selectedCity}city`)
  )
    return false;
  const ownerLocality = ownerQuery
    .split(/\s+/u)
    .map(normalize)
    .filter(
      (token) =>
        token.length >= 2 &&
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token) &&
        !selectedName.includes(token) &&
        addressText.includes(token),
    );
  if (ownerLocality.length) return true;
  const locality =
    address.normalize('NFKC').match(/[\p{Script=Han}ぁ-んァ-ヶ]+[区市郡]/gu) ??
    [];
  if (locality.length)
    return locality.some((part) => addressText.includes(normalize(part)));
  return Object.entries(aliasesByLocality).some(
    ([latin, japanese]) =>
      latinAddress.includes(latin) &&
      (addressText.includes(normalize(japanese)) ||
        addressText.includes(latin)),
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
