import type { AtlasItem } from '../catalog/atlas-item.ts';
import type { RecommendConversationItem } from './recommend-conversation.ts';
import type { RecommendDecisionSuggestion } from './recommend-decision.ts';

export interface RecommendRouteSource {
  readonly seconds: number;
  readonly checkedAt: string;
  readonly source: { readonly label: string; readonly url: string };
  readonly estimateBasis?: 'average';
}

export function materializeRecommendReceipt(
  suggestions: readonly RecommendDecisionSuggestion[],
  eligibleItems: readonly AtlasItem[],
  currentItems: readonly AtlasItem[],
  routeSources: ReadonlyMap<string, RecommendRouteSource>,
  warnings: readonly string[],
): readonly RecommendConversationItem[] | undefined {
  if (suggestions.length < 1 || suggestions.length > 5) return undefined;
  const allowed = new Map(eligibleItems.map((item) => [item.id, item]));
  const current = new Map(currentItems.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const recommendations: RecommendConversationItem[] = [];
  for (const suggestion of suggestions) {
    const selected = allowed.get(suggestion.itemId);
    const item = current.get(suggestion.itemId);
    if (
      seen.has(suggestion.itemId) ||
      suggestion.detailTargetId !== suggestion.itemId ||
      !selected ||
      !item ||
      item.kind !== 'food' ||
      item.verificationStatus !== 'verified' ||
      item.title !== selected.title ||
      item.address !== selected.address ||
      item.latitude !== selected.latitude ||
      item.longitude !== selected.longitude ||
      item.area !== selected.area ||
      item.hasVisited !== selected.hasVisited ||
      item.tags.length !== selected.tags.length ||
      item.tags.some((tag, index) => tag !== selected.tags[index]) ||
      typeof suggestion.reason !== 'string' ||
      !suggestion.reason.trim() ||
      !Array.isArray(suggestion.reasonFacts) ||
      !suggestion.reasonFacts.length
    )
      return undefined;
    seen.add(item.id);
    const evidence = suggestion.routeClaim
      ? routeSources.get(`${item.id}:${suggestion.routeClaim.mode}`)
      : undefined;
    if (
      suggestion.routeClaim &&
      (!evidence ||
        evidence.seconds !== suggestion.routeClaim.seconds ||
        evidence.estimateBasis !== suggestion.routeClaim.estimateBasis ||
        !evidence.source.label.trim() ||
        !evidence.source.url.startsWith('https://'))
    )
      return undefined;
    recommendations.push({
      ...suggestion,
      name: item.title,
      address: item.address,
      warnings,
      ...(suggestion.routeClaim && evidence
        ? {
            route: {
              ...suggestion.routeClaim,
              checkedAt: evidence.checkedAt,
              source: evidence.source,
              ...(evidence.estimateBasis
                ? { estimateBasis: evidence.estimateBasis }
                : {}),
            },
          }
        : {}),
    });
  }
  return recommendations;
}
