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
}

export interface RecommendRouteObservation {
  readonly itemId: string;
  readonly mode: 'walk' | 'transit';
  readonly seconds: number | null;
  readonly status: 'fresh' | 'stale' | 'unavailable';
  readonly transfers?: number;
  readonly doorToDoor?: boolean;
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
}

export type RecommendReasonFact =
  | {
      readonly kind: 'saved' | 'unvisited' | 'visited' | 'entry_unknown';
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

function relevantItems(
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
    return true;
  });
}

function preferenceRank(
  item: RecommendDecisionItem,
  intent: RecommendDecisionIntent,
) {
  return intent.visited === 'prefer_unvisited' && item.visited ? 1 : 0;
}

function suggestion(
  item: RecommendDecisionItem,
  input: RecommendDecisionInput,
  route?: { readonly mode: 'walk' | 'transit'; readonly seconds: number },
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
  if (input.intent.askWalkIn && input.entryState === 'unknown')
    facts.push({ kind: 'entry_unknown', value: true });
  const reason = route
    ? `Saved ${matchedFood ?? 'restaurant'}; verified ${route.mode === 'walk' ? 'walk' : 'direct train'} route ${Math.ceil(route.seconds / 60)} min.`
    : distance !== undefined
      ? `Saved ${matchedFood ?? 'restaurant'}; ${distance} m straight-line distance, travel time unverified.`
      : `Saved ${matchedFood ?? 'restaurant'} in ${item.area}${item.visited ? ', visited' : ', not yet visited'}.`;
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
  const accessWarning =
    input.intent.askWalkIn && input.entryState === 'unknown'
      ? ['walk_in_unknown']
      : [];
  if (input.intent.travelMode === 'none') {
    const selected = items
      .sort(
        (a, b) =>
          preferenceRank(a, input.intent) - preferenceRank(b, input.intent),
      )
      .slice(0, 5);
    return {
      action: 'recommend',
      recommendations: selected.map((item) => suggestion(item, input)),
      warnings: accessWarning,
    };
  }

  const maxSeconds = (input.intent.maxMinutes ?? 15) * 60;
  const eligible = items.flatMap((item) => {
    const route = input.routes
      .filter(
        (candidate) =>
          candidate.itemId === item.id &&
          candidate.status === 'fresh' &&
          candidate.seconds !== null &&
          candidate.seconds <= maxSeconds &&
          (input.intent.travelMode === 'either' ||
            candidate.mode === input.intent.travelMode) &&
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
      ? [{ item, route: { mode: route.mode, seconds: route.seconds } }]
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
      warnings: accessWarning,
    };
  }

  if (input.intent.travelMode === 'either') {
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
        warnings: [...accessWarning, 'unverified_travel_time'],
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
