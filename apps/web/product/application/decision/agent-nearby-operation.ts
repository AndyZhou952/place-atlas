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

export interface NearbyRecommendInput {
  readonly locationHint: string;
}

export interface NearbyRouteResult {
  readonly mode: 'walking' | 'direct_transit';
  readonly durationMinutes: number;
  readonly checkedAt: string;
  readonly source: ProviderAttribution;
}

export interface NearbyVisitResult {
  readonly manualVisited: boolean;
  readonly visitCount: number;
  readonly latestVisitAt?: string;
  readonly personalRating?: number;
}

export interface NearbyExternalRatingResult {
  readonly platform: string;
  readonly score: number;
  readonly sourceUrl: string;
  readonly checkedAt: string;
  readonly reviewCount?: number;
}

export interface NearbyRecommendCandidate {
  readonly itemId: string;
  readonly name: string;
  readonly kind: AtlasItem['kind'];
  readonly area: string;
  readonly address: string;
  readonly straightLineDistanceKm: number;
  readonly route?: NearbyRouteResult;
  readonly visit: NearbyVisitResult;
  readonly entryAccess: EntryAccessSnapshot;
  readonly reservation: { readonly label: string; readonly checkedAt?: string };
  readonly externalRating?: NearbyExternalRatingResult;
  readonly reason: string;
  readonly warnings: readonly string[];
  readonly mapDeepLink: string;
}

export type NearbyRecommendResult =
  | {
      readonly status: 'ambiguous';
      readonly candidates: readonly {
        readonly canonicalAddress: string;
      }[];
      readonly attribution: ProviderAttribution;
      readonly provenance: LocationResolutionProvenance;
    }
  | {
      readonly status: 'unresolved';
      readonly reason: 'not_found' | 'dependency_failure';
      readonly warning: string;
      readonly provenance?: LocationResolutionProvenance;
    }
  | {
      readonly status: 'resolved';
      readonly requestedLocation: string;
      readonly resolvedLocation: string;
      readonly recommendations: readonly NearbyRecommendCandidate[];
      readonly attribution: ProviderAttribution;
      readonly provenance: LocationResolutionProvenance;
    };

export interface NearbyPersonalFacts {
  readonly manualVisited: boolean;
  readonly visitCount: number;
  readonly latestVisitAt?: string;
  readonly personalRating?: number;
}

export interface NearbyPersonalFactsRead {
  read(itemId: string): Promise<NearbyPersonalFacts>;
}

export interface NearbyRecommendOperationDependencies extends NearbyRecommendationDependencies {
  readonly entryAccessProvider: EntryAccessProvider;
  readonly entryAccessPolicy: EntryAccessVerificationPolicy;
  readonly personalFacts: NearbyPersonalFactsRead;
  readonly mapDeepLink: (item: AtlasItem) => string;
  readonly nearbyRecommendation?: NearbyRecommendation;
}

/** @deprecated Use NearbyRecommendOperationDependencies. */
export type AgentNearbyOperationDependencies =
  NearbyRecommendOperationDependencies;

export type NearbyRecommendOperationDefinition = OperationDefinition<
  'nearby.recommend',
  NearbyRecommendInput,
  NearbyRecommendResult,
  'json'
>;

export type NearbyRecommendApplicationDefinitions = {
  readonly 'nearby.recommend': NearbyRecommendOperationDefinition;
};

/** @deprecated Use NearbyRecommendApplicationDefinitions. */
export type AgentNearbyApplicationDefinitions =
  NearbyRecommendApplicationDefinitions;

export function createNearbyRecommendationOperationGroup(
  dependencies: NearbyRecommendOperationDependencies,
) {
  const recommendation =
    dependencies.nearbyRecommendation ??
    createNearbyRecommendation(dependencies);
  const nearby: OperationDefinition<
    'nearby.recommend',
    NearbyRecommendInput,
    NearbyRecommendResult,
    'json'
  > = {
    descriptor: {
      key: 'nearby.recommend',
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
        return success(await structureOutcome(result.value, dependencies));
      } catch {
        return dependencyFailure();
      }
    },
  };
  return defineOperationGroup({ 'nearby.recommend': nearby });
}

async function structureOutcome(
  outcome: NearbyRecommendationOutcome,
  dependencies: NearbyRecommendOperationDependencies,
): Promise<NearbyRecommendResult> {
  if (outcome.status === 'ambiguous') {
    return {
      status: 'ambiguous',
      candidates: outcome.candidates.map(({ canonicalAddress }) => ({
        canonicalAddress,
      })),
      attribution: projectAttribution(outcome.attribution),
      provenance: projectProvenance(outcome.provenance),
    };
  }
  if (outcome.status === 'unresolved') {
    return {
      status: 'unresolved',
      reason: outcome.reason,
      warning: outcome.warning,
      ...(outcome.provenance
        ? { provenance: projectProvenance(outcome.provenance) }
        : {}),
    };
  }

  const selected = selectFinalCandidates(outcome);
  const withAccess = await enrichFinalNearbyCandidatesWithEntryAccess(
    selected,
    dependencies.entryAccessProvider,
    dependencies.entryAccessPolicy,
  );
  const verifiedItems = await dependencies.catalog.list('verified_catalog');
  const verifiedItemsById = new Map(
    verifiedItems
      .filter((item) => item.verificationStatus === 'verified')
      .map((item) => [item.id, item] as const),
  );
  const recommendations = await Promise.all(
    withAccess.map(async (candidate) => {
      const item = verifiedItemsById.get(candidate.itemId);
      if (!item) {
        return undefined;
      }
      const facts = await readPersonalFacts(dependencies.personalFacts, item);
      return toReceiptCandidate(candidate, item, facts, dependencies);
    }),
  );
  return {
    status: 'resolved',
    requestedLocation: outcome.requestedLocation,
    resolvedLocation: outcome.resolvedLocation,
    recommendations: recommendations.filter(
      (candidate): candidate is NearbyRecommendCandidate =>
        candidate !== undefined,
    ),
    attribution: projectAttribution(outcome.attribution),
    provenance: projectProvenance(outcome.provenance),
  };
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
  return reader.read(item.id);
}

function toReceiptCandidate(
  candidate: SelectedCandidate & {
    readonly entryAccess: EntryAccessSnapshot;
  },
  item: AtlasItem,
  facts: NearbyPersonalFacts,
  dependencies: NearbyRecommendOperationDependencies,
): NearbyRecommendCandidate {
  const route =
    candidate.layer === 'walking' && 'route' in candidate
      ? {
          mode: 'walking' as const,
          durationMinutes: Math.ceil(candidate.route.durationSeconds / 60),
          checkedAt: candidate.route.checkedAt,
          source: projectAttribution(candidate.route.attribution),
        }
      : candidate.layer === 'direct_transit' && 'route' in candidate
        ? {
            mode: 'direct_transit' as const,
            durationMinutes: Math.ceil(candidate.route.durationSeconds / 60),
            checkedAt: candidate.route.checkedAt,
            source: projectAttribution(candidate.route.attribution),
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
    visit: projectPersonalFacts(facts),
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

function projectAttribution(
  attribution: ProviderAttribution,
): ProviderAttribution {
  return {
    label: attribution.label,
    url: attribution.url,
  };
}

function projectProvenance(
  provenance: LocationResolutionProvenance,
): LocationResolutionProvenance {
  return {
    providerId: provenance.providerId,
    policyVersion: provenance.policyVersion,
    sourceUrl: provenance.sourceUrl,
    checkedAt: provenance.checkedAt,
  };
}

function projectPersonalFacts(facts: NearbyPersonalFacts): NearbyVisitResult {
  return {
    manualVisited: facts.manualVisited,
    visitCount: facts.visitCount,
    ...(facts.latestVisitAt === undefined
      ? {}
      : { latestVisitAt: facts.latestVisitAt }),
    ...(facts.personalRating === undefined
      ? {}
      : { personalRating: facts.personalRating }),
  };
}

function validateNearbyInput(input: unknown): Result<NearbyRecommendInput> {
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
