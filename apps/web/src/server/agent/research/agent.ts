// The research agent: one bounded, read-only run for the branch the Owner selected.
// 1. Read what the application can find itself: the Tabelog listing (pasted, or found by one
//    search), the official site, and a TableCheck/Toreta booking page.
// 2. Let the model fill gaps with at most two searches in three turns within 35 seconds.
// 3. Keep only facts quoted from a source about the same branch; on any failure, fall back to the
//    facts of the verified listing alone. Persistence stays in the Add workflow.
import {
  validateEnrichedProfile,
  validateWebResearchOutput,
  type WebResearchPort,
} from '../add/coordinator.ts';
import { formatOpeningHours } from '../../../shared/hours.ts';
import {
  compactRestaurantCategories,
  composeRestaurantSummary,
} from '../../../shared/restaurant-profile.ts';
import {
  canonicalTableCheckBookingUrl,
  canonicalToretaBookingUrl,
  explicitReservationTiming,
  readTableCheckBookingPage,
  readToretaBookingPage,
  type TableCheckBookingEvidence,
} from './booking.ts';
import {
  canonicalListingUrl,
  escapePattern,
  initialResearchQuery,
  isGoogleMapsRatingUrl,
  matchesSelectedBranch,
  numericToken,
  sameOrigin,
  supported,
  supportedIdentity,
} from './branch-match.ts';
import {
  isTabelogRestaurantListing,
  restaurantResearchPrompt,
  restaurantSearchDescription,
} from './instructions.ts';
import { readOfficialSite } from './official-site.ts';
import type { RestaurantSourceReader } from './page-reader.ts';
import { readTabelogListingResult, type TabelogEvidence } from './tabelog-listing.ts';
import { createWebSearch, type SearchEvidence } from './web-search.ts';

export interface AgentConfiguration {
  apiKey: string;
  baseUrl: string;
  model: string;
  searchApiKey?: string;
  fetch?: typeof fetch;
  readSourcePages?: boolean;
  sourceReader?: RestaurantSourceReader;
}

type Listing = NonNullable<TabelogEvidence['restaurant']>;
const unknown = { status: 'unknown' as const };
const unavailable = { kind: 'unavailable' as const };

/** Undefined when no model is configured at all; unavailable when it is configured incompletely. */
export function createConfiguredPlaceResearchAgent(options: {
  agentApiKey?: string;
  agentBaseUrl?: string;
  agentModel?: string;
  searchApiKey?: string;
  sourceReader?: RestaurantSourceReader;
  fetch?: typeof fetch;
}): WebResearchPort | undefined {
  if (!options.agentApiKey && !options.agentBaseUrl && !options.agentModel && !options.searchApiKey)
    return undefined;
  const unavailablePort = { research: async () => unavailable };
  if (!options.agentApiKey || !options.agentBaseUrl || !options.agentModel) return unavailablePort;
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
    return unavailablePort;
  }
}

/** Tabelog's reservation row as a reservation rule; absence of a rule stays unknown. */
function listingReservation(policy: string | undefined, url: string, observedAt: string) {
  const mode = /予約不可/u.test(policy ?? '')
    ? 'not_reservable'
    : /完全予約制|予約必須|要予約/u.test(policy ?? '')
      ? 'reservation_required'
      : /予約可/u.test(policy ?? '')
        ? 'reservable'
        : undefined;
  return policy && mode
    ? {
        status: 'known' as const,
        mode,
        label: policy.slice(0, 500),
        ...(mode === 'not_reservable' ? {} : explicitReservationTiming(policy)),
        url,
        provenance: 'agent_observed' as const,
        observedAt,
        freshness: 'fresh' as const,
      }
    : unknown;
}

/** A verified booking page wins the reservation rule; its link and booking window are explicit. */
function withBookingPage(
  reservation: Record<string, unknown>,
  booking: TableCheckBookingEvidence,
  observedAt: string,
) {
  const policy =
    reservation.status === 'known' && reservation.mode !== 'not_reservable'
      ? reservation
      : undefined;
  return {
    status: 'known' as const,
    mode: (policy?.mode as string | undefined) ?? 'reservable',
    label: (policy?.label as string | undefined) ?? '予約可',
    bookingWindowLabel: booking.booking.bookingWindowLabel,
    ...(booking.booking.advanceDays === undefined
      ? {}
      : { advanceDays: booking.booking.advanceDays }),
    ...(booking.booking.releaseNote ? { releaseNote: booking.booking.releaseNote } : {}),
    url: booking.url,
    provenance: 'agent_observed' as const,
    observedAt,
    freshness: 'fresh' as const,
  };
}

export function createPlaceResearchAgent(config: AgentConfiguration): WebResearchPort {
  const base = new URL(config.baseUrl.replace(/\/$/, '') + '/');
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !config.apiKey ||
    !config.model
  )
    throw new TypeError('Agent requires an HTTPS base URL, model and API key.');
  const endpoint = new URL('chat/completions', base).href;
  const fetcher = config.fetch ?? fetch;
  const readPages = config.readSourcePages !== false;
  const searchProvider = createWebSearch({
    ...(config.searchApiKey ? { apiKey: config.searchApiKey } : {}),
    fetch: fetcher,
  });
  return {
    async research(input) {
      if (!('selectedSubject' in input)) return unavailable;
      const subject = input.selectedSubject;
      const signal = AbortSignal.timeout(35_000);
      const isSubject = (text: string, address?: string, postalCode?: string, name?: string) =>
        matchesSelectedBranch(
          text,
          subject.transientName,
          subject.transientAddress,
          subject.ownerQuery,
          address,
          postalCode,
          name,
        );
      /** Does a parsed listing describe the selected branch (its aliases count as names)? */
      const isSubjectListing = (listing: Listing, withAliases = true) =>
        isSubject(
          withAliases
            ? `${listing.name} ${listing.aliases?.join(' ') ?? ''} ${listing.address}`
            : `${listing.name} ${listing.address}`,
          listing.address,
          listing.postalCode,
          listing.name,
        );
      const evidence: TabelogEvidence[] = [];
      let officialPageBudget = 4;
      const readOfficialUrls = new Set<string>();
      let officialBookingLink: { value: string; sourceUrl: string } | undefined;
      let bookingEvidence: TableCheckBookingEvidence | undefined;
      const messages: Record<string, unknown>[] = [
        { role: 'system', content: restaurantResearchPrompt },
        { role: 'user', content: JSON.stringify(subject) },
      ];
      let searches = 0;
      let successfulSearches = 0;
      const readUrls = new Set<string>();
      const usedCallIds = new Set<string>();
      let sourceAccessIssue: 'blocked' | 'unavailable' | undefined;
      let nameBridgeRead = false;

      /** The selected branch's listing: the pasted one, or the first listing that matches. */
      const matchedListing = () =>
        evidence.find(
          (source) =>
            source.restaurant &&
            (subject.providerNamespace === 'tabelog'
              ? source.url.replace(/\/$/u, '') === subject.placeId.replace(/\/$/u, '')
              : isSubjectListing(source.restaurant)),
        );
      const officialListing = () =>
        evidence.find(
          (source) =>
            source.restaurant?.officialWebsite && isSubjectListing(source.restaurant, false),
        );

      const readListing = async (url: string) => {
        const result = config.sourceReader
          ? await config.sourceReader(url, signal)
          : await readTabelogListingResult(url, fetcher, signal);
        if (result.kind !== 'read') {
          if (result.kind === 'blocked') sourceAccessIssue = 'blocked';
          else sourceAccessIssue ??= 'unavailable';
          return undefined;
        }
        const page = result.evidence;
        const details = page.restaurant;
        // A romanized Google name may only match the listing's English page: read it once and
        // accept its name as an alias when name, address and postal code agree exactly.
        if (
          !details ||
          !page.englishListingUrl ||
          nameBridgeRead ||
          readUrls.size >= 3 ||
          !/[a-z]/iu.test(subject.transientName) ||
          isSubjectListing(details)
        )
          return page;
        nameBridgeRead = true;
        const englishUrl = new URL(url);
        englishUrl.pathname = '/en' + englishUrl.pathname;
        englishUrl.search = '';
        englishUrl.hash = '';
        if (page.englishListingUrl !== englishUrl.href) return page;
        readUrls.add(englishUrl.href);
        try {
          const translated = config.sourceReader
            ? await config.sourceReader(englishUrl.href, signal)
            : await readTabelogListingResult(englishUrl.href, fetcher, signal);
          const bridge =
            translated.kind === 'read' && translated.evidence.url === englishUrl.href
              ? translated.evidence.nameBridge
              : undefined;
          const key = (text: string) => text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');
          if (
            bridge &&
            key(bridge.japaneseName) === key(details.name) &&
            key(bridge.address) === key(details.address) &&
            (!details.postalCode || bridge.postalCode === details.postalCode) &&
            isSubject(
              `${bridge.name} ${details.name} ${details.address}`,
              details.address,
              details.postalCode,
              details.name,
            )
          )
            return {
              ...page,
              content: `${page.content}\nSame-listing bilingual identity (${englishUrl.href}): ${translated.kind === 'read' ? translated.evidence.content : ''}`,
              restaurant: { ...details, aliases: [...(details.aliases ?? []), bridge.name] },
            };
        } catch {
          // The bridge is optional; the listing itself is still usable.
        }
        return page;
      };

      // Search order is not branch identity: prefer corroborated snippets, and try another
      // listing after a wrong branch or a failed read.
      const readSelectedListing = async (sources: SearchEvidence[]) => {
        const ranked = [...sources].sort(
          (a, b) =>
            Number(isSubject(`${b.title} ${b.content}`)) -
            Number(isSubject(`${a.title} ${a.content}`)),
        );
        for (const source of ranked) {
          if (readUrls.size >= 3) break;
          const url = canonicalListingUrl(source.url);
          if (!url || readUrls.has(url)) continue;
          readUrls.add(url);
          const page = await readListing(url);
          if (!page) continue;
          sources.unshift(page);
          if (page.restaurant?.bookingLink)
            sources.push({
              url: page.restaurant.bookingLink,
              title: page.title,
              content: page.content,
            });
          if (page.restaurant && isSubjectListing(page.restaurant)) break;
        }
      };

      const readSelectedBookingPage = async (sources: SearchEvidence[]) => {
        if (bookingEvidence) return;
        for (const [index, source] of sources.entries()) {
          const bookingUrl =
            canonicalTableCheckBookingUrl(source.url) ?? canonicalToretaBookingUrl(source.url);
          if (!bookingUrl) continue;
          const result = await (
            canonicalToretaBookingUrl(bookingUrl)
              ? readToretaBookingPage
              : readTableCheckBookingPage
          )(bookingUrl, fetcher, signal);
          if (result.kind !== 'read') continue;
          const booking = result.evidence.booking;
          const directBranch = booking.address
            ? isSubject(
                `${booking.name} ${booking.address}`,
                booking.address,
                booking.postalCode,
                booking.name,
              )
            : false;
          // Modern merchant pages omit their street address. Require the same distinctive title
          // and official website as a selected-branch listing.
          const key = (value: string) =>
            value
              .normalize('NFKC')
              .toLowerCase()
              .replace(/[\p{P}\p{Z}\s]/gu, '');
          const modernBranch = [...sources, ...evidence].some((item) => {
            const listing = (item as TabelogEvidence).restaurant;
            if (!listing?.officialWebsite || !booking.officialWebsiteHost) return false;
            let officialHost: string;
            try {
              officialHost = new URL(listing.officialWebsite).hostname.replace(/^www\./u, '');
            } catch {
              return false;
            }
            return (
              key(booking.name).length >= 4 &&
              key(booking.name) === key(listing.name) &&
              officialHost === booking.officialWebsiteHost &&
              isSubjectListing(listing)
            );
          });
          if (!directBranch && !modernBranch) continue;
          bookingEvidence = result.evidence;
          sources[index] = result.evidence;
          break;
        }
      };

      const readOfficialPages = async (website: string, maximumPages: number) => {
        if (!readPages || officialPageBudget <= 0 || readOfficialUrls.has(website)) return;
        readOfficialUrls.add(website);
        const pageLimit = Math.min(maximumPages, officialPageBudget);
        officialPageBudget -= pageLimit;
        const pages = await readOfficialSite(website, signal, fetcher, pageLimit);
        for (const link of pages.flatMap((page) => page.branchLinks ?? []))
          if (isSubject(`${link.name} ${link.address}`, link.address, undefined, link.name))
            await readOfficialPages(link.url, 1);
        const branchPages = pages.filter((page) => isSubject(page.content));
        evidence.push(...branchPages);
        const declared = branchPages.flatMap((page) =>
          page.bookingLinks.map((link) => ({ ...link, sourceUrl: page.url })),
        );
        const uniqueLinks = [...new Map(declared.map((link) => [link.url, link])).values()];
        if (uniqueLinks.length === 1)
          officialBookingLink = { value: uniqueLinks[0].url, sourceUrl: uniqueLinks[0].sourceUrl };
        // A verified official origin can point to merchant pages even without a branch-scoped
        // address. These are hints: the merchant reader still verifies its own identity.
        const hints = [
          ...new Map(
            pages.flatMap((page) => page.bookingLinks).map((link) => [link.url, link]),
          ).values(),
        ];
        await readSelectedBookingPage(
          hints.map((link) => ({
            title: 'Official-origin booking hint',
            content: '',
            url: link.url,
          })),
        );
        if (branchPages.length)
          messages.push({
            role: 'user',
            content: JSON.stringify({ discoveredOfficialSources: branchPages }),
          });
      };

      const readDiscoveredOfficialPages = async (sources: SearchEvidence[]) => {
        const website = officialListing()?.restaurant?.officialWebsite;
        if (!website) return;
        for (const source of sources)
          if (sameOrigin(source.url, website)) await readOfficialPages(source.url, 1);
      };

      const readSearchResults = async (sources: SearchEvidence[], listings = true) => {
        if (readPages) {
          if (listings) await readSelectedListing(sources);
          await readSelectedBookingPage(sources);
          await readDiscoveredOfficialPages(sources);
        }
        evidence.push(...sources);
      };

      const copyListingFacts = (
        profile: Record<string, unknown>,
        listing: TabelogEvidence,
        observedAt: string,
      ) => {
        if (!listing.restaurant) return;
        for (const field of [
          'name',
          'address',
          'area',
          'coordinates',
          'categories',
          'officialWebsite',
          'openingHours',
          'regularClosingDays',
          'closingNotes',
        ] as const) {
          const value = listing.restaurant[field];
          if (value !== undefined && (!Array.isArray(value) || value.length))
            profile[field] = {
              value:
                field === 'openingHours' && typeof value === 'string'
                  ? formatOpeningHours(value)
                  : value,
              sourceUrl: listing.url,
              observedAt,
            };
        }
      };
      const addBookingLink = (profile: Record<string, unknown>, observedAt: string) => {
        if (officialBookingLink) profile.bookingLink = { ...officialBookingLink, observedAt };
        if (bookingEvidence)
          profile.bookingLink = {
            value: bookingEvidence.url,
            sourceUrl: bookingEvidence.url,
            observedAt,
          };
      };
      const dropInvalidFields = (profile: Record<string, unknown>) => {
        for (const key of Object.keys(profile))
          if (!validateEnrichedProfile({ [key]: profile[key] })) delete profile[key];
        return validateEnrichedProfile(profile);
      };
      const tabelogFact = (listing: Listing, url: string, observedAt: string) =>
        listing.score !== undefined
          ? {
              status: 'known' as const,
              score: listing.score,
              url,
              provenance: 'agent_observed' as const,
              observedAt,
              freshness: 'fresh' as const,
            }
          : unknown;
      const observed = (value: unknown) => {
        const checked = validateWebResearchOutput(value, {
          tabelog: unknown,
          reservation: unknown,
        });
        return checked
          ? {
              kind: 'observed' as const,
              value: checked,
              ...(sourceAccessIssue ? { sourceAccessIssue } : {}),
            }
          : unavailable;
      };

      /** Facts from the verified listing alone, when the model run fails. */
      const verifiedListingFallback = () => {
        const listing = matchedListing();
        if (!listing?.restaurant) return unavailable;
        const observedAt = new Date().toISOString();
        const profile: Record<string, unknown> = {};
        copyListingFacts(profile, listing, observedAt);
        const checked = dropInvalidFields(profile);
        const summary = composeRestaurantSummary({
          categories: checked?.categories?.value,
          area: checked?.area?.value,
        });
        if (summary && (checked?.categories || checked?.area))
          profile.summary = { value: summary, sourceUrl: listing.url, observedAt };
        addBookingLink(profile, observedAt);
        const base = listingReservation(listing.restaurant.reservation, listing.url, observedAt);
        return observed({
          tabelog: tabelogFact(listing.restaurant, listing.url, observedAt),
          reservation: bookingEvidence ? withBookingPage(base, bookingEvidence, observedAt) : base,
          ...(Object.keys(profile).length ? { profile } : {}),
        });
      };
      const recoverVerifiedListing = () => {
        try {
          return verifiedListingFallback();
        } catch {
          return unavailable;
        }
      };

      try {
        // A pasted listing URL (or a Tabelog candidate) is read directly.
        const selectedListing =
          subject.providerNamespace === 'tabelog'
            ? subject.placeId
            : subject.ownerQuery.match(/https:\/\/tabelog\.com\/[^\s]+/u)?.[0];
        if (selectedListing && isTabelogRestaurantListing(selectedListing) && readPages) {
          const page = await readListing(selectedListing);
          readUrls.add(selectedListing);
          if (page) {
            evidence.push(page);
            if (page.restaurant?.bookingLink)
              await readSelectedBookingPage([
                { url: page.restaurant.bookingLink, title: page.title, content: page.content },
                page,
              ]);
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
        // Anchor discovery in the provider's selected name before the model can mistranslate a
        // neighborhood. This spends one of the same two searches, never an extra hidden one.
        if (!selectedListing && successfulSearches === 0 && readPages) {
          searches++;
          const query = initialResearchQuery(subject);
          const result = await searchProvider.search(query, signal);
          if (result.kind === 'results') {
            successfulSearches++;
            await readSearchResults(result.sources);
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
        const officialWebsite = readPages
          ? officialListing()?.restaurant?.officialWebsite
          : undefined;
        if (officialWebsite) await readOfficialPages(officialWebsite, 2);
        // A branch-matched listing can name its booking provider without the booking URL. Spend
        // the remaining search on that provider so the model cannot miss the booking rules.
        const bookingSearchListing = evidence.find(
          (source) =>
            source.restaurant &&
            (source.restaurant.bookingProviderHint ||
              /予約可|完全予約制|予約必須|要予約/u.test(source.restaurant.reservation ?? '')) &&
            isSubjectListing(source.restaurant),
        )?.restaurant;
        if (bookingSearchListing && !bookingEvidence && searches < 2) {
          searches++;
          // The listing already fixed the branch; its long address would crowd the merchant page
          // out of a three-result search.
          const hint = bookingSearchListing.bookingProviderHint;
          const query =
            hint === 'tablecheck'
              ? `${bookingSearchListing.name} TableCheck site:tablecheck.com 予約`
              : hint === 'toreta'
                ? `${bookingSearchListing.name} Toreta site:yoyaku.toreta.in 予約`
                : `${bookingSearchListing.name} ${bookingSearchListing.area} reservation 公式 予約`;
          const result = await searchProvider.search(query, signal);
          if (result.kind === 'results') {
            successfulSearches++;
            await readSearchResults(result.sources, false);
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
              ...(base.hostname === 'api.deepseek.com' ? { reasoning_effort: 'none' } : {}),
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
          const message = (await readJson(response, 32_768))?.choices?.[0]?.message;
          if (!message || typeof message !== 'object') return recoverVerifiedListing();
          if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
            if (message.tool_calls.length > 2 - searches) return recoverVerifiedListing();
            // Validate the whole batch before executing any external search.
            const batch: { id: string; query: string }[] = [];
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
              if (typeof args?.query !== 'string' || !args.query.trim() || args.query.length > 500)
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
                await readSearchResults(result.sources);
              }
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result.kind === 'results' ? result.sources : result),
              });
            }
            continue;
          }
          if (typeof message.content !== 'string' || successfulSearches === 0)
            return recoverVerifiedListing();
          return acceptProposal(JSON.parse(message.content));
        }
      } catch {
        const recovered = recoverVerifiedListing();
        return recovered.kind === 'unavailable' && signal.aborted
          ? { kind: 'unavailable', reason: 'timed_out' }
          : recovered;
      }
      return unavailable;

      /** Accept only quoted, same-branch claims from the model's final answer. */
      // oxlint-disable-next-line typescript/no-explicit-any -- untrusted model JSON, checked field by field
      function acceptProposal(proposal: any) {
        const listing = matchedListing();
        // The parsed main listing has its own branch check; do not discard its facts because the
        // model is uncertain.
        if (proposal.subjectMatch !== 'matched' && !listing && !bookingEvidence)
          return {
            kind: 'observed' as const,
            value: { tabelog: unknown, reservation: unknown },
            ...(sourceAccessIssue ? { sourceAccessIssue } : {}),
          };
        const observedAt = new Date().toISOString();
        // oxlint-disable-next-line typescript/no-explicit-any -- untrusted model JSON
        const identityOf = (proof: any) =>
          supportedIdentity(
            proof,
            { url: proof?.identityUrl ?? proof?.url, quote: proof?.identityQuote },
            evidence,
            subject,
          );
        const fact = (field: 'tabelog' | 'reservation'): Record<string, unknown> => {
          const value = proposal[field];
          const quote = proposal.evidence?.[field];
          const identityQuote =
            typeof quote?.identityQuote === 'string'
              ? { url: quote.identityUrl ?? quote.url, quote: quote.identityQuote }
              : proposal.evidence?.identity;
          if (
            !supportedIdentity(quote, identityQuote, evidence, subject) ||
            value?.status !== 'known' ||
            quote?.url !== value.url ||
            !supported(quote, evidence)
          )
            return unknown;
          if (
            field === 'reservation' &&
            !['reservable', 'reservation_required', 'not_reservable'].includes(value.mode)
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
                      (typeof value[key] === 'string' && quote.quote.includes(value[key]))),
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
        // Opening hours, closing days and closing notes come only from the parsed listing row,
        // never from model prose.
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
          const proof = proposal.evidence?.[field] ?? proposal.profile?.evidence?.[field];
          // A parsed listing already passed the branch check; a quoted dish needs no separate
          // identity quote from that same listing.
          const verifiedListingProof = listing && proof?.url === listing.url;
          if (
            claim === undefined ||
            !supported(proof, evidence) ||
            (field === 'googleRating' &&
              (!isGoogleMapsRatingUrl(proof.url) ||
                !/Google|rating|reviews?|評分|评分|評価/iu.test(proof.quote))) ||
            (!verifiedListingProof && !identityOf(proof))
          )
            continue;
          if (field === 'bookingLink') {
            // Only reader-verified providers or an explicit booking anchor on the verified
            // official origin are actionable links.
            const officialOrigin = listing?.restaurant?.officialWebsite;
            const officialSource = Boolean(officialOrigin && sameOrigin(proof.url, officialOrigin));
            const explicitAnchor =
              typeof claim === 'string' &&
              new RegExp(
                `(?:reservations?|reserve now|book a table|book now|booking|予約)[^\\n]{0,100}: ${escapePattern(claim)}`,
                'iu',
              ).test(proof.quote);
            if (!(bookingEvidence?.url === claim || (officialSource && explicitAnchor))) continue;
          }
          if (
            field === 'officialWebsite' &&
            typeof claim === 'string' &&
            claim !== listing?.restaurant?.officialWebsite &&
            !/official(?: website)?|ホームページ|公式サイト/iu.test(proof.quote)
          )
            continue;
          if (field === 'signatureDishes' && Array.isArray(claim)) {
            // Ignore typography, not words; keep supported dishes even if another is invented.
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
            if (dishes.length) profile[field] = { value: dishes, sourceUrl: proof.url, observedAt };
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
              profile[field] = { value: categories, sourceUrl: proof.url, observedAt };
            continue;
          }
          // Exact factual values must occur in the quote.
          const tokens = Array.isArray(claim)
            ? claim
            : field === 'googleRating' && claim && typeof claim === 'object'
              ? [claim.score, ...(claim.reviewCount === undefined ? [] : [claim.reviewCount])]
              : [claim];
          if (
            tokens.every((token: unknown) =>
              typeof token === 'number'
                ? numericToken(proof.quote, token)
                : typeof token === 'string' && proof.quote.includes(token),
            )
          )
            profile[field] = { value: claim, sourceUrl: proof.url, observedAt };
        }

        let reservation = fact('reservation');
        let tabelog = fact('tabelog');
        if (listing?.restaurant) {
          copyListingFacts(profile, listing, observedAt);
          const listed = tabelogFact(listing.restaurant, listing.url, observedAt);
          if (listed.status === 'known') tabelog = listed;
          // Absence of a policy is unknown. A refusal is a policy but says nothing about seats.
          if (reservation.status === 'unknown')
            reservation = listingReservation(
              listing.restaurant.reservation,
              listing.url,
              observedAt,
            );
        }
        addBookingLink(profile, observedAt);
        if (bookingEvidence)
          reservation = withBookingPage(reservation, bookingEvidence, observedAt);
        const checked = dropInvalidFields(profile);
        if (checked) {
          // Prose is composed from validated facts, never from model text.
          const summary = composeRestaurantSummary({
            categories: checked.categories?.value,
            dishes: checked.signatureDishes?.value,
            area: checked.area?.value,
          });
          const summarySource = checked.categories ?? checked.signatureDishes ?? checked.area;
          if (summary && summarySource)
            profile.summary = { value: summary, sourceUrl: summarySource.sourceUrl, observedAt };
        }
        return observed({
          tabelog,
          reservation,
          ...(Object.keys(profile).length ? { profile } : {}),
        });
      }
    },
  };
}

// Bodies are streamed under a byte limit, including providers ignoring max_tokens.
type ProviderResponse = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
  }[];
};

async function readJson(response: Response, maximum: number): Promise<ProviderResponse> {
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
