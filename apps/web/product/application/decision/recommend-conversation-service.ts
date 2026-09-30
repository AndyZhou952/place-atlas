import type { AtlasItem } from '../catalog/atlas-item.ts';
import type { CatalogRead } from '../catalog/catalog-read.ts';
import { distanceInKm } from './geo-distance-policy.ts';
import type {
  LocationResolver,
  RouteProvider,
  TransitRouteProvider,
} from './nearby-recommendation.ts';
import {
  parseRecommendConversationInput,
  type RecommendConversationInput,
  type RecommendConversationOutput,
} from './recommend-conversation.ts';
import {
  decideRecommend,
  relevantItems,
  type RecommendDecisionItem,
  type RecommendDecisionOrigin,
  type RecommendRouteObservation,
} from './recommend-decision.ts';
import {
  normalizeRecommendFoodTerm,
  normalizeRecommendIntent,
  type RecommendOriginOption,
} from './recommend-intent.ts';
import { normalizeSearchText } from './search-policy.ts';
import {
  materializeRecommendReceipt,
  type RecommendRouteSource,
} from './recommend-receipt.ts';

export interface RecommendInterpreter {
  interpret(
    input: RecommendConversationInput,
    options: readonly RecommendOriginOption[],
  ): Promise<unknown>;
}

export interface RecommendConversationDependencies {
  readonly catalog: CatalogRead;
  readonly interpreter: RecommendInterpreter;
  readonly locationResolver: LocationResolver;
  readonly routeProvider: RouteProvider;
  readonly transitRouteProvider?: TransitRouteProvider;
  readonly clock: { readonly now: () => Date };
}

const unavailable = (): RecommendConversationOutput => ({
  status: 'unavailable',
  message: 'Recommendations are temporarily unavailable. Please retry.',
  retryable: true,
});

const unsupportedJapanTrain = (): RecommendConversationOutput => ({
  status: 'unavailable',
  message:
    'Train route times in Japan are unavailable from the current provider. Try walking or remove the travel-time limit.',
  retryable: false,
});

function reportUnavailable(stage: 'catalog' | 'interpreter', error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const reason =
    stage === 'interpreter' &&
    [
      'Recommend model is not configured',
      'Recommend model unavailable',
      'Recommend model response too large',
      'Recommend model response invalid',
      'Recommend model response incomplete',
      'Recommend model answer invalid',
    ].includes(message)
      ? message
      : 'unexpected failure';
  console.warn('Recommend unavailable', {
    stage,
    reason,
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

const normalize = normalizeSearchText;

function defaultNearbyFallback(query: string): boolean {
  return (
    /near me|附近有啥|附近有什么|近くの/iu.test(query) &&
    !/徒歩|歩いて|歩行|步行|走路|\bwalk|電車|电车|\btrain|\btransit|(?:\d{1,2}|十|十五|二十)\s*(?:分|分钟|分鐘|minute)/iu.test(
      query,
    )
  );
}

function optionsFromCatalog(
  items: readonly AtlasItem[],
): RecommendOriginOption[] {
  const options: RecommendOriginOption[] = [];
  const areas = new Set<string>();
  for (const item of items) {
    for (const area of item.area.split(/[·・,/]/u).map((part) => part.trim())) {
      if (!area || areas.has(area)) continue;
      areas.add(area);
      options.push({ id: `area:${area}`, kind: 'area', names: [area] });
    }
    options.push({
      id: `place:${item.id}`,
      kind: 'place',
      names: [
        item.title,
        ...(item.alternateTitle ? [item.alternateTitle] : []),
      ],
    });
  }
  return options;
}

function userMessages(input: RecommendConversationInput): string[] {
  return [
    input.query,
    ...input.replies.flatMap((reply) => ['Clarification answer:', reply]),
  ];
}

function addExplicitStationMentions(
  options: RecommendOriginOption[],
  input: RecommendConversationInput,
): void {
  for (const message of [input.query, ...input.replies]) {
    const japaneseStations = [
      ...message.matchAll(
        /(?:^|[でからの\s、。])([\p{L}\p{N}・ー-]{1,60}駅)(?=$|[かまでのへ\s、。])/gu,
      ),
    ].map((match) => match[1]);
    const englishStations = [
      ...message.matchAll(
        /\b(?:from|near|at|around)\s+((?:[\p{L}\p{N}-]+\s+){1,3}Station)\b/giu,
      ),
    ].map((match) => match[1]);
    if (!englishStations.length) {
      const bareStation = message.match(
        /^((?:[\p{L}\p{N}-]+\s+){1,3}Station)(?=$|から|で|へ)/iu,
      );
      if (bareStation) englishStations.push(bareStation[1]);
    }
    for (const station of [...japaneseStations, ...englishStations]) {
      if (
        options.some((option) =>
          option.names.some((name) => normalize(name) === normalize(station)),
        )
      )
        continue;
      options.push({
        id: `query:${station}`,
        kind: 'station',
        names: [station],
      });
    }
  }
}

function addOriginText(
  options: RecommendOriginOption[],
  raw: unknown,
  input: RecommendConversationInput,
): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.originText !== 'string' ||
    value.originText.length < 2 ||
    value.originText.length > 200 ||
    !['area', 'station', 'address', 'place'].includes(
      value.originKind as string,
    )
  )
    return;
  const originText = value.originText.trim();
  const disclosed = [input.query, ...input.replies].some((message) => {
    if (normalize(message).includes(normalize(originText))) return true;
    try {
      const url = new URL(message);
      if (
        !['www.google.com', 'google.com', 'maps.google.com'].includes(
          url.hostname,
        ) ||
        !url.pathname.startsWith('/maps/')
      )
        return false;
      const location =
        url.searchParams.get('query') ??
        url.searchParams.get('q') ??
        (url.pathname.startsWith('/maps/place/')
          ? decodeURIComponent(
              (url.pathname.split('/')[3] ?? '').replaceAll('+', ' '),
            )
          : null);
      return Boolean(
        location && normalize(location).includes(normalize(originText)),
      );
    } catch {
      return false;
    }
  });
  if (!disclosed) return;
  if (
    options.some((option) =>
      option.names.some((name) => normalize(name) === normalize(originText)),
    )
  )
    return;
  options.push({
    id: `query:${originText}`,
    kind: value.originKind as RecommendOriginOption['kind'],
    names: [originText],
  });
  value.originId = `query:${originText}`;
}

function currentRoute(
  route: { readonly status: string; readonly checkedAt?: string },
  now: Date,
): boolean {
  if (route.status !== 'fresh' || !route.checkedAt) return false;
  return recentTimestamp(route.checkedAt, now);
}

function recentTimestamp(value: string, now: Date): boolean {
  const age = now.getTime() - Date.parse(value);
  return Number.isFinite(age) && age >= -5_000 && age <= 5 * 60 * 1000;
}

export function createRecommendConversationService(
  dependencies: RecommendConversationDependencies,
) {
  return {
    async ask(rawInput: unknown): Promise<RecommendConversationOutput> {
      const input = parseRecommendConversationInput(rawInput);
      if (!input) throw new Error('Invalid Recommend request');
      if (
        input.originChoice &&
        ![input.query, ...input.replies.slice(0, -1)].some((message) =>
          normalize(message).includes(normalize(input.originChoice!.hint)),
        )
      )
        return {
          status: 'clarify',
          clarification: 'origin',
          question: 'What starting point should I use?',
        };
      let items: readonly AtlasItem[];
      try {
        items = (await dependencies.catalog.list('verified_catalog')).filter(
          (item) =>
            item.kind === 'food' && item.verificationStatus === 'verified',
        );
      } catch (error) {
        reportUnavailable('catalog', error);
        return unavailable();
      }
      const options = optionsFromCatalog(items);
      let rawIntent: unknown;
      try {
        rawIntent = await dependencies.interpreter.interpret(input, options);
      } catch (error) {
        reportUnavailable('interpreter', error);
        return unavailable();
      }
      if (
        !rawIntent ||
        typeof rawIntent !== 'object' ||
        Array.isArray(rawIntent) ||
        !['recommend', 'clarify', 'unsupported'].includes(
          (rawIntent as Record<string, unknown>).action as string,
        ) ||
        !Array.isArray((rawIntent as Record<string, unknown>).foodTerms)
      )
        return unavailable();
      addExplicitStationMentions(options, input);
      addOriginText(options, rawIntent, input);
      const intent = normalizeRecommendIntent(
        userMessages(input),
        options,
        rawIntent,
      );
      const allowDefaultFallback =
        defaultNearbyFallback(input.query) && intent.travelMode === 'walk';
      if (intent.action === 'unsupported')
        return {
          status: 'clarify',
          clarification: 'full_address_or_link',
          question: 'Please paste a full Google Maps link or address.',
        };
      if (
        intent.action === 'clarify' &&
        !(
          input.originChoice &&
          [
            'origin',
            'origin_choice',
            'exact_origin',
            'unresolved_origin',
          ].includes(intent.clarification ?? '')
        )
      )
        return {
          status: 'clarify',
          clarification: intent.clarification as 'origin',
          question: intent.question ?? 'What starting point should I use?',
        };

      const selectedOption = options.find(
        (option) => option.id === intent.originId,
      );
      let origin: RecommendDecisionOrigin = { state: 'none' };
      let point: { latitude: number; longitude: number } | undefined;
      if (input.originChoice) {
        try {
          const resolution = await dependencies.locationResolver.resolve(
            input.originChoice.hint,
          );
          if (resolution.status === 'unresolved')
            return resolution.reason === 'dependency_failure'
              ? unavailable()
              : {
                  status: 'clarify',
                  clarification: 'unresolved_origin',
                  question:
                    'Could you provide a more precise address or station?',
                };
          const candidates =
            resolution.status === 'ambiguous'
              ? resolution.candidates
              : [resolution.location];
          const matches = candidates.filter(
            (candidate) =>
              candidate.canonicalAddress === input.originChoice?.id,
          );
          if (matches.length > 1)
            return {
              status: 'clarify',
              clarification: 'unresolved_origin',
              question: 'Could you provide a more precise address or station?',
            };
          if (matches.length === 0)
            return {
              status: 'clarify',
              clarification: 'origin_choice',
              question: 'Which exact location is your starting point?',
              originHint: input.originChoice.hint,
              options: candidates.slice(0, 5).map((candidate) => ({
                id: candidate.canonicalAddress,
                label: candidate.canonicalAddress,
              })),
            };
          origin = {
            state: 'resolved',
            id: `choice:${matches[0].canonicalAddress}`,
          };
          point = matches[0].point;
        } catch {
          return unavailable();
        }
      } else if (selectedOption?.kind === 'area') {
        origin = {
          state: 'area',
          id: selectedOption.id,
          name: selectedOption.names[0],
        };
      } else if (selectedOption?.kind === 'place') {
        const item = items.find(
          (candidate) => `place:${candidate.id}` === selectedOption.id,
        );
        if (item) {
          origin = { state: 'resolved', id: selectedOption.id };
          point = { latitude: item.latitude, longitude: item.longitude };
        }
      }
      if (selectedOption && !point && selectedOption.kind !== 'area') {
        try {
          const resolution = await dependencies.locationResolver.resolve(
            selectedOption.names[0],
          );
          if (resolution.status === 'ambiguous')
            return {
              status: 'clarify',
              clarification: 'origin_choice',
              question: 'Which exact location is your starting point?',
              originHint: selectedOption.names[0],
              options: resolution.candidates.slice(0, 5).map((candidate) => ({
                id: candidate.canonicalAddress,
                label: candidate.canonicalAddress,
              })),
            };
          if (resolution.status === 'unresolved')
            return resolution.reason === 'dependency_failure'
              ? unavailable()
              : {
                  status: 'clarify',
                  clarification: 'unresolved_origin',
                  question:
                    'Could you provide a more precise address or station?',
                };
          origin = { state: 'resolved', id: selectedOption.id };
          point = resolution.location.point;
        } catch {
          return unavailable();
        }
      }
      if (intent.travelMode !== 'none' && !point)
        return {
          status: 'clarify',
          clarification: origin.state === 'area' ? 'exact_origin' : 'origin',
          question: 'Where exactly are you starting from?',
        };

      const eligibleItems =
        origin.state === 'area'
          ? items.filter((item) =>
              selectedOption?.names.some((name) =>
                normalize(item.area).includes(normalize(name)),
              ),
            )
          : selectedOption?.kind === 'place'
            ? items.filter((item) => `place:${item.id}` !== selectedOption.id)
            : items;
      const catalog: RecommendDecisionItem[] = eligibleItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        verificationStatus: item.verificationStatus,
        title: item.title,
        area: origin.state === 'area' ? origin.id : item.area,
        address: item.address,
        tags: [
          ...new Set(
            item.tags.flatMap((tag) =>
              [tag, normalizeRecommendFoodTerm(tag)].filter(
                (value): value is string => Boolean(value),
              ),
            ),
          ),
        ],
        visited: item.hasVisited === true,
      }));
      const distances = point
        ? eligibleItems.map((item) => ({
            itemId: item.id,
            meters: Math.round(
              distanceInKm(point, {
                latitude: item.latitude,
                longitude: item.longitude,
              }) * 1000,
            ),
          }))
        : [];
      const routes: RecommendRouteObservation[] = [];
      const routeSources = new Map<string, RecommendRouteSource>();
      let routeState: 'unavailable' | undefined;
      const relevantIds = new Set(
        relevantItems(
          {
            intent: {
              foodTerms: intent.foodTerms,
              excludedFoodTerms: intent.excludedFoodTerms,
              travelMode: intent.travelMode,
              visited: intent.visited,
            },
            origin,
            catalogIds: catalog.map((item) => item.id),
            routes: [],
            distances: [],
          },
          catalog,
        ).map((item) => item.id),
      );
      const routeItems = eligibleItems.filter((item) =>
        relevantIds.has(item.id),
      );
      const transitUnsupported =
        point !== undefined &&
        routeItems.length > 0 &&
        (intent.travelMode === 'transit' ||
          intent.travelMode === 'either' ||
          allowDefaultFallback) &&
        dependencies.transitRouteProvider?.coverage?.(point) ===
          'unsupported_region';
      if (transitUnsupported && intent.travelMode === 'transit')
        return unsupportedJapanTrain();
      if (point && intent.travelMode !== 'none') {
        if (intent.travelMode === 'walk' || intent.travelMode === 'either') {
          try {
            const evidence = dependencies.routeProvider.walkingMany
              ? await dependencies.routeProvider.walkingMany(
                  point,
                  routeItems.map((item) => ({
                    latitude: item.latitude,
                    longitude: item.longitude,
                  })),
                )
              : await Promise.all(
                  routeItems.map((item) =>
                    dependencies.routeProvider.walking(point, {
                      latitude: item.latitude,
                      longitude: item.longitude,
                    }),
                  ),
                );
            evidence.forEach((route, index) => {
              const fresh =
                currentRoute(route, dependencies.clock.now()) &&
                route.status === 'fresh' &&
                Number.isFinite(route.durationSeconds) &&
                route.durationSeconds >= 0;
              if (!fresh) routeState = 'unavailable';
              routes.push({
                itemId: routeItems[index].id,
                mode: 'walk',
                seconds:
                  route.status === 'fresh' ? route.durationSeconds : null,
                status: fresh ? 'fresh' : 'unavailable',
              });
              if (fresh)
                routeSources.set(`${routeItems[index].id}:walk`, {
                  seconds: route.durationSeconds,
                  checkedAt: route.checkedAt,
                  source: route.attribution,
                });
            });
            if (evidence.length !== routeItems.length)
              routeState = 'unavailable';
          } catch {
            routeState = 'unavailable';
          }
        }
        const hasUnvisitedCandidate = routeItems.some(
          (item) => item.hasVisited !== true,
        );
        const qualifyingWalk = routes.some((route) => {
          const item = routeItems.find(
            (candidate) => candidate.id === route.itemId,
          );
          return (
            route.mode === 'walk' &&
            route.status === 'fresh' &&
            route.seconds !== null &&
            route.seconds <= (intent.maxMinutes ?? 15) * 60 &&
            (intent.visited !== 'prefer_unvisited' ||
              !hasUnvisitedCandidate ||
              item?.hasVisited !== true)
          );
        });
        if (
          intent.travelMode === 'transit' ||
          intent.travelMode === 'either' ||
          (allowDefaultFallback && !qualifyingWalk)
        ) {
          if (transitUnsupported || !dependencies.transitRouteProvider)
            routeState = 'unavailable';
          else {
            const transitLimitMinutes = allowDefaultFallback
              ? 20
              : (intent.maxMinutes ?? 20);
            const shortlist = routeItems
              .map((item) => ({
                item,
                meters:
                  distances.find((distance) => distance.itemId === item.id)
                    ?.meters ?? Infinity,
              }))
              .filter(
                ({ meters }) => meters <= transitLimitMinutes * 6_000 + 2_000,
              )
              .sort(
                (a, b) =>
                  (intent.visited === 'prefer_unvisited' && a.item.hasVisited
                    ? 1
                    : 0) -
                    (intent.visited === 'prefer_unvisited' && b.item.hasVisited
                      ? 1
                      : 0) || a.meters - b.meters,
              );
            let foundDirectRoute = false;
            for (
              let offset = 0;
              offset < Math.min(shortlist.length, 10) && !foundDirectRoute;
              offset += 5
            ) {
              const batch = shortlist.slice(offset, offset + 5);
              const batchMatches = await Promise.all(
                batch.map(async ({ item }) => {
                  try {
                    const route =
                      await dependencies.transitRouteProvider!.transit(point, {
                        latitude: item.latitude,
                        longitude: item.longitude,
                      });
                    const fresh =
                      currentRoute(route, dependencies.clock.now()) &&
                      route.status === 'fresh' &&
                      Number.isFinite(route.durationSeconds) &&
                      route.durationSeconds >= 0;
                    if (
                      route.status === 'unavailable' ||
                      route.status === 'stale' ||
                      (route.status === 'no_direct_route' &&
                        !recentTimestamp(
                          route.checkedAt,
                          dependencies.clock.now(),
                        ))
                    )
                      routeState = 'unavailable';
                    routes.push({
                      itemId: item.id,
                      mode: 'transit',
                      seconds:
                        route.status === 'fresh' ? route.durationSeconds : null,
                      status: fresh ? 'fresh' : 'unavailable',
                      transfers:
                        route.status === 'fresh'
                          ? route.transferCount
                          : undefined,
                      doorToDoor:
                        route.status === 'fresh' && route.boardingCount >= 1,
                      estimateBasis:
                        route.status === 'fresh'
                          ? route.estimateBasis
                          : undefined,
                    });
                    if (fresh)
                      routeSources.set(`${item.id}:transit`, {
                        seconds: route.durationSeconds,
                        checkedAt: route.checkedAt,
                        source: route.attribution,
                        ...(route.estimateBasis
                          ? { estimateBasis: route.estimateBasis }
                          : {}),
                      });
                    return (
                      fresh &&
                      route.status === 'fresh' &&
                      route.transferCount === 0 &&
                      route.boardingCount === 1 &&
                      route.durationSeconds <= transitLimitMinutes * 60
                    );
                  } catch {
                    routeState = 'unavailable';
                    return false;
                  }
                }),
              );
              foundDirectRoute = batchMatches.some(Boolean);
            }
            if (!foundDirectRoute && shortlist.length > 10)
              routeState = 'unavailable';
          }
        }
      }
      const decision = decideRecommend(
        {
          intent: {
            foodTerms: intent.foodTerms,
            excludedFoodTerms: intent.excludedFoodTerms,
            travelMode: intent.travelMode,
            ...(intent.maxMinutes !== null
              ? { maxMinutes: intent.maxMinutes }
              : {}),
            visited: intent.visited,
          },
          origin,
          catalogIds: catalog.map((item) => item.id),
          routes,
          distances,
          ...(routeState ? { routeState } : {}),
          ...(allowDefaultFallback ? { defaultNearbyFallback: true } : {}),
        },
        catalog,
      );
      if (decision.action === 'clarify')
        return {
          status: 'clarify',
          clarification: 'origin',
          question: decision.question ?? 'Which starting point?',
        };
      if (decision.action === 'unavailable')
        return transitUnsupported ? unsupportedJapanTrain() : unavailable();
      if (decision.action === 'no_results')
        return {
          status: 'no_results',
          message: 'No saved restaurants match this request yet.',
        };
      let currentItems: readonly AtlasItem[];
      try {
        currentItems = await dependencies.catalog.list('verified_catalog');
      } catch {
        return unavailable();
      }
      const recommendations = materializeRecommendReceipt(
        decision.recommendations,
        eligibleItems,
        currentItems,
        routeSources,
        decision.warnings,
      );
      if (!recommendations) return unavailable();
      return {
        status: 'recommend',
        warnings: decision.warnings,
        recommendations,
      };
    },
  };
}
