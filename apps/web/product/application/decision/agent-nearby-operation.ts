import {
  defineOperationGroup,
  type OperationDefinition,
} from '../atlas-application.ts';
import type { AtlasItem } from '../catalog/atlas-item.ts';
import { failure, success, type Result } from '../result.ts';
import { enrichFinalNearbyCandidatesWithEntryAccess } from './entry-access-nearby-decorator.ts';
import type {
  EntryAccessProvider,
  EntryAccessVerificationPolicy,
  EntryAccessSnapshot,
} from './entry-access.ts';
import { createNearbyRecommendation } from './nearby-recommendation-operation.ts';
import type {
  DirectTransitCandidate,
  DistanceCandidate,
  LocationResolutionProvenance,
  ProviderAttribution,
  NearbyRecommendation,
  NearbyRecommendationDependencies,
  NearbyRecommendationOutcome,
  WalkingRecommendation,
} from './nearby-recommendation.ts';
import {
  presentNearbyWechatReceipt,
  type NearbyReceiptCandidate,
} from './nearby-result-presenter.ts';

export interface AgentNearbyInput {
  readonly locationHint: string;
}

export interface AgentNearbyResult {
  readonly outcome: NearbyRecommendationOutcome;
  readonly replyText: string;
}

export interface NearbyPersonalFacts {
  readonly manualVisited: boolean;
  readonly visitCount: number;
  readonly latestVisitAt?: string;
  readonly personalRating?: number;
}

export interface NearbyPersonalFactsRead {
  read(itemId: string): Promise<NearbyPersonalFacts>;
}

export interface AgentNearbyOperationDependencies extends NearbyRecommendationDependencies {
  readonly entryAccessProvider: EntryAccessProvider;
  readonly entryAccessPolicy: EntryAccessVerificationPolicy;
  readonly personalFacts: NearbyPersonalFactsRead;
  readonly mapDeepLink: (item: AtlasItem) => string;
  readonly nearbyRecommendation?: NearbyRecommendation;
}

export type AgentNearbyOperationDefinition = OperationDefinition<
  'agent.nearby',
  AgentNearbyInput,
  AgentNearbyResult,
  'json'
>;

export type AgentNearbyApplicationDefinitions = {
  readonly 'agent.nearby': AgentNearbyOperationDefinition;
};

export function createNearbyRecommendationOperationGroup(
  dependencies: AgentNearbyOperationDependencies,
) {
  const recommendation =
    dependencies.nearbyRecommendation ??
    createNearbyRecommendation(dependencies);
  const nearby: AgentNearbyOperationDefinition = {
    descriptor: {
      key: 'agent.nearby',
      resultKind: 'json',
      effect: 'read',
      validate: validateNearbyInput,
    },
    async handle(input) {
      let result: Result<NearbyRecommendationOutcome>;
      try {
        result = await recommendation.execute(input);
      } catch {
        return dependencyFailure();
      }
      if (!result.ok) return result;

      try {
        return success({
          outcome: result.value,
          replyText: await presentOutcome(result.value, dependencies),
        });
      } catch {
        return dependencyFailure();
      }
    },
  };
  return defineOperationGroup({ 'agent.nearby': nearby });
}

async function presentOutcome(
  outcome: NearbyRecommendationOutcome,
  dependencies: AgentNearbyOperationDependencies,
): Promise<string> {
  if (outcome.status === 'ambiguous') {
    const choices = outcome.candidates
      .slice(0, 3)
      .map((candidate, index) => `${index + 1}. ${candidate.canonicalAddress}`);
    return [
      'Japan Atlas｜这个位置有多个可能，请选择更具体的地址：',
      ...choices,
      attributionLine(outcome.attribution, outcome.provenance),
    ].join('\n');
  }
  if (outcome.status === 'unresolved') {
    return [
      `Japan Atlas｜无法确认位置：${outcome.warning}`,
      provenanceFailureLine(outcome.provenance),
    ].join('\n');
  }

  const selected = selectFinalCandidates(outcome);
  const withAccess = await enrichFinalNearbyCandidatesWithEntryAccess(
    selected,
    dependencies.entryAccessProvider,
    dependencies.entryAccessPolicy,
  );
  const recommendations = await Promise.all(
    withAccess.map(async (candidate) => {
      const item = await dependencies.catalog.get(candidate.itemId);
      if (!item) return undefined;
      const facts = await readPersonalFacts(dependencies.personalFacts, item);
      return toReceiptCandidate(candidate, item, facts, dependencies);
    }),
  );
  return [
    attributionLine(outcome.attribution, outcome.provenance),
    presentNearbyWechatReceipt({
      resolvedLocation: outcome.resolvedLocation,
      recommendations: recommendations.filter(
        (candidate): candidate is NearbyReceiptCandidate =>
          candidate !== undefined,
      ),
    }),
  ].join('\n');
}

type SelectedCandidate = (
  | WalkingRecommendation
  | DistanceCandidate
  | DirectTransitCandidate
) & {
  readonly layer: 'walking' | 'distance' | 'direct_transit';
  readonly warning?: string;
};

function selectFinalCandidates(
  outcome: Extract<
    NearbyRecommendationOutcome,
    { readonly status: 'resolved' }
  >,
): readonly SelectedCandidate[] {
  if (outcome.recommendations.length > 0) {
    return outcome.recommendations
      .slice(0, 5)
      .map((candidate) => ({ ...candidate, layer: 'walking' as const }));
  }
  const selected: SelectedCandidate[] = outcome.distanceCandidates.map(
    (candidate) => ({ ...candidate, layer: 'distance' as const }),
  );
  const seen = new Set(selected.map(({ itemId }) => itemId));
  for (const candidate of outcome.directTransitCandidates) {
    if (seen.has(candidate.itemId)) continue;
    selected.push({ ...candidate, layer: 'direct_transit' });
    seen.add(candidate.itemId);
  }
  return selected.slice(0, 5);
}

async function readPersonalFacts(
  reader: NearbyPersonalFactsRead,
  item: AtlasItem,
): Promise<NearbyPersonalFacts> {
  try {
    return await reader.read(item.id);
  } catch {
    return {
      manualVisited: item.hasVisited === true,
      visitCount: item.hasVisited === true ? 1 : 0,
      ...(item.hasVisited === true && item.personalRating !== undefined
        ? { personalRating: item.personalRating }
        : {}),
    };
  }
}

function toReceiptCandidate(
  candidate: SelectedCandidate & {
    readonly entryAccess: EntryAccessSnapshot;
  },
  item: AtlasItem,
  facts: NearbyPersonalFacts,
  dependencies: AgentNearbyOperationDependencies,
): NearbyReceiptCandidate {
  const route =
    candidate.layer === 'walking' && 'route' in candidate
      ? {
          mode: 'walking' as const,
          durationMinutes: Math.ceil(candidate.route.durationSeconds / 60),
          checkedAt: candidate.route.checkedAt,
          source: candidate.route.attribution,
        }
      : candidate.layer === 'direct_transit' && 'route' in candidate
        ? {
            mode: 'direct_transit' as const,
            durationMinutes: Math.ceil(candidate.route.durationSeconds / 60),
            checkedAt: candidate.route.checkedAt,
            source: candidate.route.attribution,
          }
        : undefined;
  return {
    itemId: item.id,
    name: item.title,
    kind: item.kind,
    area: item.area,
    address: item.address,
    straightLineDistanceKm: candidate.straightLineDistanceKm,
    ...(route ? { route } : {}),
    visit: facts,
    entryAccess: candidate.entryAccess,
    reservation: {
      label: item.reservation.label,
      checkedAt: item.reservation.checkedAt,
    },
    ...(item.tabelog
      ? {
          externalRating: {
            platform: '食べログ',
            score: item.tabelog.score,
            sourceUrl: item.tabelog.url,
            checkedAt: item.tabelog.checkedAt,
            ...(item.tabelog.reviewCount === undefined
              ? {}
              : { reviewCount: item.tabelog.reviewCount }),
          },
        }
      : {}),
    reason:
      candidate.layer === 'walking'
        ? '步行 15 分钟内可达'
        : candidate.layer === 'direct_transit'
          ? '20 分钟内无需换乘电车可达'
          : '2 公里内的距离候选',
    warnings: candidate.warning ? [candidate.warning] : [],
    mapDeepLink: dependencies.mapDeepLink(item),
  };
}

function validateNearbyInput(input: unknown): Result<AgentNearbyInput> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    typeof (input as Record<string, unknown>).locationHint !== 'string' ||
    !(input as Record<string, string>).locationHint.trim()
  ) {
    return failure('invalid_input', 'A location hint is required.');
  }
  return success({
    locationHint: (input as Record<string, string>).locationHint.trim(),
  });
}

function dependencyFailure(): Result<never> {
  return failure(
    'dependency_failure',
    'Japan Atlas nearby is temporarily unavailable.',
  );
}

function attributionLine(
  attribution: ProviderAttribution,
  provenance: LocationResolutionProvenance,
): string {
  return `位置来源：${attribution.label} · 查询：${provenance.sourceUrl} · 核验：${provenance.checkedAt} · 策略：${provenance.providerId}/${provenance.policyVersion}`;
}

function provenanceFailureLine(
  provenance: LocationResolutionProvenance | undefined,
): string {
  return provenance
    ? `位置查询：${provenance.sourceUrl} · 核验：${provenance.checkedAt} · 策略：${provenance.providerId}/${provenance.policyVersion}`
    : '位置来源：不可用（未获得本次查询的可审计来源）';
}
