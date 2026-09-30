import { normalizeSearchText } from './search-policy.ts';

export interface RecommendOriginOption {
  readonly id: string;
  readonly kind: 'area' | 'station' | 'address' | 'place';
  readonly names: readonly string[];
}

export interface RecommendIntent {
  readonly action: 'recommend' | 'clarify' | 'unsupported';
  readonly originId: string | null;
  readonly foodTerms: readonly string[];
  readonly excludedFoodTerms: readonly string[];
  readonly travelMode: 'none' | 'walk' | 'transit' | 'either';
  readonly maxMinutes: number | null;
  readonly visited:
    | 'prefer_unvisited'
    | 'only_unvisited'
    | 'only_visited'
    | 'any';
  readonly clarification?: string;
  readonly question?: string;
  readonly reason?: string;
}

const foodAliases: Readonly<Record<string, readonly string[]>> = {
  ramen: ['ramen', 'ラーメン', 'らーめん', '拉面', '拉麵'],
  sushi: ['sushi', '寿司', '壽司', 'すし'],
  curry: ['curry', 'カレー', '咖喱', '咖哩'],
  yakitori: ['yakitori', '焼き鳥', '焼鳥', 'やきとり', '烧鸟'],
  beef_tongue: ['beef_tongue', 'beef tongue', '牛タン', '牛たん', '牛舌'],
  coffee: ['coffee', 'コーヒー', '咖啡'],
};

function normalized(value: string): string {
  return normalizeSearchText(value.replace(/\bstation\b/giu, '駅'))
    .replaceAll('银', '銀')
    .replaceAll('站', '駅')
    .replaceAll('ー', '')
    .replace(/[丁目番地]/gu, '');
}

export function normalizeRecommendFoodTerm(term: string): string | undefined {
  const value = normalized(term);
  return Object.entries(foodAliases).find(([, aliases]) =>
    aliases.some((alias) => normalized(alias) === value),
  )?.[0];
}

function foodList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((term) =>
        typeof term === 'string'
          ? [normalizeRecommendFoodTerm(term)].filter(Boolean)
          : [],
      ),
    ),
  ] as string[];
}

function queryText(messages: readonly string[]): string {
  return [
    messages[0],
    ...messages.slice(2).filter((_, index) => index % 2 === 0),
  ]
    .filter(Boolean)
    .join(' ');
}

function safeMapQuery(
  message: string,
):
  | { readonly status: 'none'; readonly text: string }
  | { readonly status: 'short' | 'untrusted'; readonly text: string } {
  const urlText = message.match(/https?:\/\/\S+/u)?.[0];
  if (!urlText) return { status: 'none', text: message };
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return { status: 'untrusted', text: message };
  }
  if (url.hostname === 'maps.app.goo.gl')
    return { status: 'short', text: message };
  if (
    !['www.google.com', 'google.com', 'maps.google.com'].includes(
      url.hostname,
    ) ||
    !url.pathname.startsWith('/maps/')
  )
    return { status: 'untrusted', text: message };
  const search = url.searchParams.get('query') ?? url.searchParams.get('q');
  return { status: 'none', text: search ?? decodeURIComponent(url.pathname) };
}

function matchOrigins(text: string, options: readonly RecommendOriginOption[]) {
  const target = normalized(text);
  return options
    .flatMap((option) =>
      option.names.flatMap((name) => {
        const search = normalized(name);
        const offset = target.indexOf(search);
        return search && offset >= 0
          ? [{ option, length: search.length, offset }]
          : [];
      }),
    )
    .sort((a, b) => b.length - a.length);
}

function matchedOriginIds(
  text: string,
  options: readonly RecommendOriginOption[],
): string[] {
  const matches = matchOrigins(text, options);
  const occupied: Array<[number, number]> = [];
  const ids: string[] = [];
  for (const match of matches) {
    const end = match.offset + match.length;
    if (occupied.some(([start, stop]) => match.offset < stop && end > start))
      continue;
    occupied.push([match.offset, end]);
    if (!ids.includes(match.option.id)) ids.push(match.option.id);
  }
  return ids;
}

export function normalizeRecommendIntent(
  messages: readonly string[],
  options: readonly RecommendOriginOption[],
  raw: unknown,
): RecommendIntent {
  const prediction =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const original = queryText(messages);
  const map = safeMapQuery(original);
  const text = map.text;
  const latest = messages.at(-1) ?? original;
  const latestOriginIds =
    messages.length > 1 ? matchedOriginIds(latest, options) : [];
  const originIds = latestOriginIds.length
    ? latestOriginIds
    : matchedOriginIds(text, options);
  const optionById = new Map(options.map((option) => [option.id, option]));
  const modelOrigin =
    typeof prediction.originId === 'string'
      ? optionById.get(prediction.originId)
      : undefined;
  const branchReply =
    messages.length > 1 &&
    modelOrigin?.kind === 'place' &&
    modelOrigin.names.some(
      (name) =>
        normalized(name).startsWith(normalized(messages[0])) &&
        normalized(name).includes(normalized(latest)),
    );
  const originId = branchReply
    ? modelOrigin.id
    : originIds.length === 1
      ? originIds[0]
      : typeof prediction.originId === 'string' &&
          optionById.has(prediction.originId)
        ? prediction.originId
        : null;
  const explicitVisited = /まだ行ってない|没去过|未去过|not\s+visited/iu.test(
    original,
  )
    ? 'only_unvisited'
    : /去过|行った|only\s+visited/iu.test(original)
      ? 'only_visited'
      : undefined;
  const visited: RecommendIntent['visited'] =
    explicitVisited ?? 'prefer_unvisited';
  const rawFood = foodList(prediction.foodTerms);
  const excludedFoodTerms = foodList(prediction.excludedFoodTerms);
  const exactPlace =
    originId &&
    optionById.get(originId)?.kind === 'place' &&
    normalized(text) ===
      normalized(
        optionById
          .get(originId)
          ?.names.find((name) => normalized(name) === normalized(text)) ?? '',
      );
  const foodTerms = exactPlace
    ? []
    : rawFood.filter(
        (term) =>
          !excludedFoodTerms.includes(term) &&
          (term !== 'coffee' || /coffee|コーヒー|咖啡/iu.test(original)),
      );
  let travelMode: RecommendIntent['travelMode'] =
    /徒歩|歩いて|歩行|步行|走路|\bwalk/iu.test(original)
      ? 'walk'
      : /電車|电车|\btrain|\btransit/iu.test(original)
        ? 'transit'
        : ['none', 'walk', 'transit', 'either'].includes(
              prediction.travelMode as string,
            )
          ? (prediction.travelMode as RecommendIntent['travelMode'])
          : 'none';
  const numbers = original.match(
    /(?:\d{1,2}|十|十五|二十)\s*(?:分|分钟|分鐘|minute)/iu,
  );
  const nearMe = /near me|附近有啥|附近有什么|近くの/iu.test(original);
  const maxMinutes = numbers
    ? ({ 十: 10, 十五: 15, 二十: 20 }[
        numbers[0].match(/^十(?:五)?|^二十/u)?.[0] ?? ''
      ] ?? Number.parseInt(numbers[0], 10))
    : nearMe
      ? 15
      : typeof prediction.maxMinutes === 'number' &&
          Number.isFinite(prediction.maxMinutes)
        ? prediction.maxMinutes
        : null;
  if (nearMe) travelMode = 'walk';
  if (
    maxMinutes === null &&
    !/徒歩|歩いて|歩行|步行|走路|\bwalk|電車|电车|\btrain|\btransit/iu.test(
      original,
    ) &&
    !nearMe
  )
    travelMode = 'none';
  if (
    maxMinutes !== null &&
    !/徒歩|歩いて|歩行|步行|走路|\bwalk|電車|电车|\btrain|\btransit/iu.test(
      original,
    ) &&
    !nearMe
  )
    travelMode = 'none';
  const common = {
    originId,
    foodTerms,
    excludedFoodTerms,
    travelMode,
    maxMinutes: Number.isFinite(maxMinutes) ? maxMinutes : null,
    visited,
  };
  const clarify = (
    clarification: string,
    question: string,
  ): RecommendIntent => ({
    action: 'clarify',
    ...common,
    clarification,
    question,
  });
  if (map.status === 'untrusted')
    return {
      action: 'unsupported',
      ...common,
      originId: null,
      reason: 'untrusted_url',
    };
  if (map.status === 'short')
    return clarify(
      'full_address_or_link',
      'Please paste the full Maps link or address.',
    );
  if (originIds.length > 1)
    return {
      ...clarify('origin_choice', 'Which starting point?'),
      originId: null,
    };
  if (!originId) {
    const placeOptions = options.filter((option) => option.kind === 'place');
    const possibleBranches = placeOptions.filter((option) =>
      option.names.some((name) =>
        normalized(name).startsWith(normalized(latest)),
      ),
    );
    if (possibleBranches.length > 1)
      return clarify('branch', 'Which branch is your starting point?');
    if (latest.endsWith('店') || /^(?:カフェ|喫茶)\s+\S+/u.test(latest))
      return {
        ...clarify(
          'unresolved_origin',
          'Which address or station is this place near?',
        ),
        foodTerms: [],
      };
  }
  const originKind = originId ? optionById.get(originId)?.kind : undefined;
  if (originKind === 'area' && travelMode !== 'none')
    return clarify('exact_origin', 'Which exact starting point in this area?');
  if (maxMinutes !== null && travelMode === 'none')
    return clarify('travel_mode', 'Walking or direct train?');
  if (!originId && travelMode !== 'none')
    return clarify('origin', 'Where are you starting from?');
  if (
    prediction.action === 'clarify' &&
    typeof prediction.clarification === 'string' &&
    !originId &&
    !foodTerms.length
  ) {
    const questions: Readonly<Record<string, string>> = {
      branch: 'Which branch is your starting point?',
      origin: 'What starting point should I use?',
      origin_choice: 'Which starting point should I use?',
      unresolved_origin: 'Could you provide a more precise address or station?',
      full_address_or_link: 'Please paste the full Maps link or address.',
    };
    const kind = Object.hasOwn(questions, prediction.clarification)
      ? prediction.clarification
      : 'origin';
    return clarify(kind, questions[kind]);
  }
  return { action: 'recommend', ...common };
}
