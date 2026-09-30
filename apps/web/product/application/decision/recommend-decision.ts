export interface RecommendDecisionIntent {
  readonly foodTerms: readonly string[];
  readonly excludedFoodTerms: readonly string[];
  readonly travelMode: 'none' | 'walk' | 'transit' | 'either';
  readonly maxMinutes?: number;
  readonly visited:
    | 'prefer_unvisited'
    | 'only_unvisited'
    | 'only_visited'
    | 'any';
  readonly askWalkIn?: boolean;
}

export type RecommendDecisionOrigin =
  | { readonly state: 'none' }
  | { readonly state: 'area'; readonly id: string; readonly name: string }
  | { readonly state: 'resolved'; readonly id: string }
  | { readonly state: 'ambiguous'; readonly choices: readonly string[] }
  | { readonly state: 'unavailable' };

export interface RecommendDecisionItem {
  readonly id: string;
  readonly kind: string;
  readonly verificationStatus: string;
  readonly title: string;
  readonly area: string;
  readonly address: string;
  readonly tags: readonly string[];
  readonly visited: boolean;
  readonly walkIn?: 'known' | 'unknown' | 'excluded';
}

export interface RecommendRouteObservation {
  readonly itemId: string;
  readonly mode: 'walk' | 'transit';
  readonly seconds: number | null;
  readonly status: 'fresh' | 'stale' | 'unavailable';
  readonly transfers?: number;
  readonly doorToDoor?: boolean;
  readonly estimateBasis?: 'average';
}

export interface RecommendDistanceObservation {
  readonly itemId: string;
  readonly meters: number;
}

export interface RecommendDecisionInput {
  readonly intent: RecommendDecisionIntent;
  readonly origin: RecommendDecisionOrigin;
  readonly catalogIds: readonly string[];
  readonly routes: readonly RecommendRouteObservation[];
  readonly distances: readonly RecommendDistanceObservation[];
  readonly routeState?: 'unavailable';
  readonly entryState?: 'unknown';
  readonly defaultNearbyFallback?: boolean;
}

export type RecommendReasonFact =
  | {
      readonly kind:
        | 'saved'
        | 'unvisited'
        | 'visited'
        | 'entry_unknown'
        | 'walk_in_known';
      readonly value: true;
    }
  | { readonly kind: 'food' | 'area'; readonly value: string }
  | { readonly kind: 'walk' | 'transit'; readonly seconds: number }
  | { readonly kind: 'distance'; readonly meters: number };

export interface RecommendDecisionSuggestion {
  readonly itemId: string;
  readonly detailTargetId: string;
  readonly reason: string;
  readonly reasonFacts: readonly RecommendReasonFact[];
  readonly routeClaim?: {
    readonly mode: 'walk' | 'transit';
    readonly seconds: number;
    readonly estimateBasis?: 'average';
  };
}

export interface RecommendDecisionResult {
  readonly action: 'recommend' | 'clarify' | 'no_results' | 'unavailable';
  readonly recommendations: readonly RecommendDecisionSuggestion[];
  readonly warnings: readonly string[];
  readonly question?: string;
}

const empty = (
  action: RecommendDecisionResult['action'],
  warnings: readonly string[] = [],
  question?: string,
): RecommendDecisionResult => ({
  action,
  recommendations: [],
  warnings,
  ...(question ? { question } : {}),
});

export function relevantItems(
  input: RecommendDecisionInput,
  catalog: readonly RecommendDecisionItem[],
): RecommendDecisionItem[] {
  const includedIds = new Set(input.catalogIds);
  return catalog.filter((item) => {
    if (
      !includedIds.has(item.id) ||
      item.kind !== 'food' ||
      item.verificationStatus !== 'verified'
    )
      return false;
    if (input.origin.state === 'area' && item.area !== input.origin.id)
      return false;
    if (
      input.intent.foodTerms.length &&
      !input.intent.foodTerms.some((term) => item.tags.includes(term))
    )
      return false;
    if (input.intent.excludedFoodTerms.some((term) => item.tags.includes(term)))
      return false;
    if (input.intent.visited === 'only_visited' && !item.visited) return false;
    if (input.intent.visited === 'only_unvisited' && item.visited) return false;
    if (input.intent.askWalkIn && item.walkIn === 'excluded') return false;
    return true;
  });
}

function preferenceRank(
  item: RecommendDecisionItem,
  intent: RecommendDecisionIntent,
) {
  return (
    (intent.askWalkIn && item.walkIn !== 'known' ? 2 : 0) +
    (intent.visited === 'prefer_unvisited' && item.visited ? 1 : 0)
  );
}

function entryWarnings(
  input: RecommendDecisionInput,
  selected: readonly RecommendDecisionItem[],
): string[] {
  if (!input.intent.askWalkIn) return [];
  return [
    'current_availability_unknown',
    ...(input.entryState === 'unknown' ||
    selected.some((item) => item.walkIn !== 'known')
      ? ['walk_in_unknown']
      : []),
  ];
}

function suggestion(
  item: RecommendDecisionItem,
  input: RecommendDecisionInput,
  route?: {
    readonly mode: 'walk' | 'transit';
    readonly seconds: number;
    readonly estimateBasis?: 'average';
  },
  distance?: number,
): RecommendDecisionSuggestion {
  const facts: RecommendReasonFact[] = [{ kind: 'saved', value: true }];
  const matchedFood = input.intent.foodTerms.find((term) =>
    item.tags.includes(term),
  );
  if (matchedFood) facts.push({ kind: 'food', value: matchedFood });
  if (input.origin.state === 'area')
    facts.push({ kind: 'area', value: item.area });
  facts.push(
    item.visited
      ? { kind: 'visited', value: true }
      : { kind: 'unvisited', value: true },
  );
  if (route) facts.push({ kind: route.mode, seconds: route.seconds });
  else if (distance !== undefined)
    facts.push({ kind: 'distance', meters: distance });
  if (input.intent.askWalkIn && item.walkIn === 'known')
    facts.push({ kind: 'walk_in_known', value: true });
  else if (input.intent.askWalkIn)
    facts.push({ kind: 'entry_unknown', value: true });
  const baseReason = route
    ? `Saved ${matchedFood ?? 'restaurant'}; ${route.estimateBasis === 'average' ? 'estimated' : 'verified'} ${route.mode === 'walk' ? 'walk' : 'direct train'} route ${Math.ceil(route.seconds / 60)} min.`
    : distance !== undefined
      ? `Saved ${matchedFood ?? 'restaurant'}; ${distance} m straight-line distance, travel time unverified.`
      : `Saved ${matchedFood ?? 'restaurant'} in ${input.origin.state === 'area' ? input.origin.name : item.area}${item.visited ? ', visited' : ', not yet visited'}.`;
  const reason = input.intent.askWalkIn
    ? `${baseReason} ${item.walkIn === 'known' ? 'Saved rule permits walk-in; current availability and queue unverified.' : 'Walk-in rule and current availability unverified.'}`
    : baseReason;
  return {
    itemId: item.id,
    detailTargetId: item.id,
    reason,
    reasonFacts: facts,
    ...(route ? { routeClaim: route } : {}),
  };
}

export function decideRecommend(
  input: RecommendDecisionInput,
  catalog: readonly RecommendDecisionItem[],
): RecommendDecisionResult {
  if (input.origin.state === 'unavailable')
    return empty('unavailable', ['location_provider_unavailable']);
  if (input.origin.state === 'ambiguous')
    return empty('clarify', [], 'Which exact starting point?');
  if (input.origin.state === 'area' && input.intent.travelMode !== 'none')
    return empty(
      'clarify',
      [],
      `Where exactly in ${input.origin.name} are you starting?`,
    );
  if (input.origin.state === 'none' && input.intent.travelMode !== 'none')
    return empty('clarify', [], 'Where are you starting from?');

  const items = relevantItems(input, catalog);
  if (!items.length) return empty('no_results');
  if (input.intent.travelMode === 'none') {
    if (input.origin.state === 'resolved') {
      const nearby = items
        .flatMap((item) => {
          const meters = input.distances.find(
            (distance) => distance.itemId === item.id,
          )?.meters;
          return meters !== undefined && meters <= 2000
            ? [{ item, meters }]
            : [];
        })
        .sort(
          (a, b) =>
            preferenceRank(a.item, input.intent) -
              preferenceRank(b.item, input.intent) || a.meters - b.meters,
        )
        .slice(0, 5);
      return nearby.length
        ? {
            action: 'recommend',
            recommendations: nearby.map(({ item, meters }) =>
              suggestion(item, input, undefined, meters),
            ),
            warnings: [
              ...entryWarnings(
                input,
                nearby.map(({ item }) => item),
              ),
              'unverified_travel_time',
            ],
          }
        : empty('no_results');
    }
    const selected = items
      .sort(
        (a, b) =>
          preferenceRank(a, input.intent) - preferenceRank(b, input.intent),
      )
      .slice(0, 5);
    return {
      action: 'recommend',
      recommendations: selected.map((item) => suggestion(item, input)),
      warnings: entryWarnings(input, selected),
    };
  }

  const maxSeconds = (input.intent.maxMinutes ?? 15) * 60;
  const defaultNearbyFallback =
    input.defaultNearbyFallback === true &&
    input.intent.travelMode === 'walk' &&
    input.intent.maxMinutes === 15;
  const eligible = items.flatMap((item) => {
    const route = input.routes
      .filter(
        (candidate) =>
          candidate.itemId === item.id &&
          candidate.status === 'fresh' &&
          candidate.seconds !== null &&
          candidate.seconds <=
            (defaultNearbyFallback && candidate.mode === 'transit'
              ? 20 * 60
              : maxSeconds) &&
          (input.intent.travelMode === 'either' ||
            candidate.mode === input.intent.travelMode ||
            (defaultNearbyFallback && candidate.mode === 'transit')) &&
          (candidate.mode === 'walk' ||
            (candidate.transfers === 0 && candidate.doorToDoor === true)),
      )
      .sort((a, b) =>
        a.mode === b.mode
          ? (a.seconds ?? 0) - (b.seconds ?? 0)
          : a.mode === 'walk'
            ? -1
            : 1,
      )[0];
    return route && route.seconds !== null
      ? [
          {
            item,
            route: {
              mode: route.mode,
              seconds: route.seconds,
              ...(route.estimateBasis
                ? { estimateBasis: route.estimateBasis }
                : {}),
            },
          },
        ]
      : [];
  });
  if (eligible.length) {
    eligible.sort(
      (a, b) =>
        preferenceRank(a.item, input.intent) -
          preferenceRank(b.item, input.intent) ||
        (a.route.mode === b.route.mode
          ? a.route.seconds - b.route.seconds
          : a.route.mode === 'walk'
            ? -1
            : 1),
    );
    return {
      action: 'recommend',
      recommendations: eligible
        .slice(0, 5)
        .map(({ item, route }) => suggestion(item, input, route)),
      warnings: entryWarnings(
        input,
        eligible.slice(0, 5).map(({ item }) => item),
      ),
    };
  }

  if (input.intent.travelMode === 'either' || defaultNearbyFallback) {
    const fallback = items
      .flatMap((item) => {
        const meters = input.distances.find(
          (distance) => distance.itemId === item.id,
        )?.meters;
        return meters !== undefined && meters <= 2000 ? [{ item, meters }] : [];
      })
      .sort(
        (a, b) =>
          preferenceRank(a.item, input.intent) -
            preferenceRank(b.item, input.intent) || a.meters - b.meters,
      );
    if (fallback.length)
      return {
        action: 'recommend',
        recommendations: fallback
          .slice(0, 5)
          .map(({ item, meters }) =>
            suggestion(item, input, undefined, meters),
          ),
        warnings: [
          ...entryWarnings(
            input,
            fallback.slice(0, 5).map(({ item }) => item),
          ),
          'unverified_travel_time',
        ],
      };
  }

  if (
    input.routeState === 'unavailable' ||
    input.routes.some(
      (route) =>
        route.mode === 'transit' &&
        route.status === 'fresh' &&
        route.doorToDoor === false,
    )
  )
    return empty('unavailable', ['unverified_travel_time']);
  return empty('no_results');
}
