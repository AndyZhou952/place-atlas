import {
  defineOperationGroup,
  type ApplicationExecutionContext,
  type OperationDefinition,
} from '../atlas-application.ts';
import {
  success,
  type ApplicationError,
  type ApplicationErrorKind,
  type Result,
} from '../result.ts';
import {
  canonicalizeCatalogIntakeWarnings,
  type CatalogIntakeWarningCode,
} from './catalog-intake-warning-policy.ts';

export type AddErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'expired'
  | 'dependency_failure'
  | 'rate_limited'
  | 'unexpected_failure';

export interface AddError extends ApplicationError {
  readonly code: AddErrorCode;
  readonly retryable?: boolean;
}

export type AddResult<T> = Result<T, AddError>;

export interface CatalogIntakeAttribution {
  readonly label: string;
  readonly url: string;
}

export interface CatalogIntakeDurableIdentity {
  readonly providerNamespace: string;
  readonly placeId: string;
  readonly ordinal: number;
}

export interface CatalogIntakeTransientPresentation {
  readonly name: string;
  readonly address: string;
  readonly attribution: CatalogIntakeAttribution;
}

export interface GooglePlaceDiscoveryCandidate {
  readonly durableIdentity: CatalogIntakeDurableIdentity;
  readonly transientPresentation: CatalogIntakeTransientPresentation;
}

export interface GooglePlaceDiscoveryPort {
  discover(input: { readonly query: string }): Promise<
    Result<{
      readonly candidates: readonly GooglePlaceDiscoveryCandidate[];
      readonly hasMore: boolean;
    }>
  >;
  refetch(input: {
    readonly providerNamespace: string;
    readonly placeId: string;
  }): Promise<Result<GooglePlaceDiscoveryCandidate>>;
}

export type DurableGeocoderProposal =
  | {
      readonly status: 'resolved';
      readonly normalizedAddress: string;
      readonly latitude: number;
      readonly longitude: number;
      readonly provider: string;
      readonly sourceUrl: string;
      readonly license: string;
      readonly checkedAt: string;
    }
  | { readonly status: 'ambiguous' }
  | { readonly status: 'no_match' };

export interface DurableGeocoderPort {
  propose(input: {
    readonly trigger: 'owner_intake_select' | 'owner_intake_confirm';
    readonly dataClassification: 'public_place_query';
    readonly ownerQuery: string;
    readonly ownerDraft: CatalogIntakeOwnerFields;
  }): Promise<Result<DurableGeocoderProposal>>;
}

export interface WebResearchPort {
  research(input: WebResearchInput): Promise<WebResearchOutcome>;
}

export type WebResearchOutcome =
  | {
      readonly kind: 'observed';
      readonly value: {
        readonly tabelog: CatalogIntakeTabelogSnapshot;
        readonly reservation: CatalogIntakeReservationSnapshot;
      };
    }
  | {
      readonly kind:
        | 'unavailable'
        | 'response_lost'
        | 'already_spent'
        | 'expired'
        | 'conflict';
    };

type WebResearchInputBase = {
  readonly scope: CatalogIntakeScope;
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
  readonly queryOrUrlsDigest: string;
};

export type WebResearchInput =
  | (WebResearchInputBase & {
      readonly phase: 'initial';
      readonly normalizedOwnerQuery: string;
    })
  | (WebResearchInputBase & {
      readonly phase: 'confirm';
      readonly canonicalUrls: readonly string[];
      readonly preview: CatalogIntakePreview;
    });

export type CatalogIntakeResearchPhase = 'initial' | 'confirm';

export interface CatalogIntakeResearchAllowance {
  readonly sessionId: string;
  readonly phase: CatalogIntakeResearchPhase;
  readonly queryOrUrlsDigest: string;
  readonly maxCounts: {
    readonly searchQueries: number;
    readonly pageRequests: number;
  };
  readonly maxDurationMs: number;
  readonly requestTimeoutMs: 15_000;
  readonly maxRedirects: 3;
  readonly deadline: string;
  readonly requestId: string;
}

export const catalogIntakeResearchBudgets = {
  initial: {
    searchQueries: 1,
    pageRequests: 3,
    maxDurationMs: 35_000,
  },
  confirm: {
    searchQueries: 0,
    pageRequests: 2,
    maxDurationMs: 25_000,
  },
} as const;

export interface CatalogIntakeScope {
  readonly ownerId: string;
  readonly channel: string;
  readonly conversationId: string;
}

export interface CatalogIntakeDiscoverInput {
  readonly query: string;
  readonly requestToken: string;
}

export interface CatalogIntakeCandidateOutput {
  readonly ordinal: number;
  readonly transientName: string;
  readonly transientAddress: string;
  readonly attribution: CatalogIntakeAttribution;
}

export interface CatalogIntakeDiscoverOutput {
  readonly status: 'candidates_ready' | 'clarification_required';
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly candidates: readonly CatalogIntakeCandidateOutput[];
  readonly hasMore: boolean;
  readonly expiresAt: string;
}

export interface CatalogIntakeOwnerFields {
  readonly title?: string;
  readonly address?: string;
  readonly area?: string;
  readonly coordinates?: {
    readonly latitude: number;
    readonly longitude: number;
  };
}

export interface OwnerTabelogAssertion {
  readonly score: number;
  readonly reviewCount?: number;
  readonly url: string;
}

export interface OwnerReservationAssertion {
  readonly mode: 'reservable' | 'reservation_required';
  readonly label: string;
  readonly advanceDays?: number;
  readonly bookingWindowLabel?: string;
  readonly releaseNote?: string;
  readonly channel?: string;
  readonly url: string;
}

export interface CatalogIntakeSelectInput {
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
  readonly ordinal: number;
  readonly ownerFields?: CatalogIntakeOwnerFields;
  readonly tabelog?: OwnerTabelogAssertion | 'unknown';
  readonly reservation?: OwnerReservationAssertion | 'unknown';
  readonly requestResearch: boolean;
}

export interface CatalogIntakeClarification {
  readonly code:
    | 'missing_area_or_address'
    | 'ambiguous_location'
    | 'duplicate_suspected';
  readonly prompt: string;
  readonly fields: readonly ('title' | 'area' | 'address' | 'coordinates')[];
}

export type CatalogIntakeTitleProposal =
  | { readonly provenance: 'owner_query'; readonly value: string }
  | {
      readonly provenance: 'agent_observed';
      readonly value: string;
      readonly sourceUrl: string;
      readonly observedAt: string;
    };

export type CatalogIntakeAddressProposal =
  | {
      readonly provenance: 'durable_geocoder_observed';
      readonly value: string;
      readonly sourceUrl: string;
      readonly license: string;
      readonly checkedAt: string;
    }
  | {
      readonly provenance: 'agent_observed';
      readonly value: string;
      readonly sourceUrl: string;
      readonly observedAt: string;
    };

export type CatalogIntakeLocationEvidence =
  | { readonly status: 'unknown' }
  | {
      readonly status: 'known';
      readonly provenance: 'durable_geocoder_observed';
      readonly normalizedAddress: string;
      readonly latitude: number;
      readonly longitude: number;
      readonly provider: string;
      readonly sourceUrl: string;
      readonly license: string;
      readonly checkedAt: string;
    }
  | {
      readonly status: 'known';
      readonly provenance: 'owner_asserted';
      readonly address: string;
      readonly latitude: number;
      readonly longitude: number;
      readonly assertedAt: string;
      readonly sourceUrl?: string;
    };

export type CatalogIntakeTabelogSnapshot =
  | { readonly status: 'unknown' }
  | {
      readonly status: 'known';
      readonly score: number;
      readonly reviewCount?: number;
      readonly url: string;
      readonly provenance: 'owner_asserted';
      readonly assertedAt: string;
      readonly freshness: 'fresh' | 'stale';
    }
  | {
      readonly status: 'known';
      readonly score: number;
      readonly reviewCount?: number;
      readonly url: string;
      readonly provenance: 'agent_observed';
      readonly observedAt: string;
      readonly freshness: 'fresh' | 'stale';
    };

export type CatalogIntakeReservationSnapshot =
  | { readonly status: 'unknown' }
  | ({
      readonly status: 'known';
      readonly provenance: 'owner_asserted';
      readonly assertedAt: string;
      readonly freshness: 'fresh' | 'stale';
    } & OwnerReservationAssertion)
  | ({
      readonly status: 'known';
      readonly provenance: 'agent_observed';
      readonly observedAt: string;
      readonly freshness: 'fresh' | 'stale';
    } & OwnerReservationAssertion);

export interface CatalogIntakeSuspectedDuplicate {
  readonly itemId: string;
  readonly title: string;
  readonly address?: string;
  readonly match: 'strong' | 'weak';
}

export interface CatalogIntakeWarning {
  readonly code: CatalogIntakeWarningCode;
  readonly message: string;
}

type CatalogIntakeSourceRole =
  | 'identity'
  | 'location'
  | 'tabelog'
  | 'reservation';

export type CatalogIntakeSource =
  | {
      readonly role: CatalogIntakeSourceRole;
      readonly label: string;
      readonly url?: string;
      readonly provenance: 'owner_asserted';
      readonly assertedAt: string;
    }
  | {
      readonly role: CatalogIntakeSourceRole;
      readonly label: string;
      readonly url: string;
      readonly provenance: 'agent_observed';
      readonly observedAt: string;
    }
  | {
      readonly role: 'location';
      readonly label: string;
      readonly url: string;
      readonly provenance: 'durable_geocoder_observed';
      readonly checkedAt: string;
      readonly license: string;
    };

export interface CatalogIntakePreview {
  readonly sessionId: string;
  readonly previewVersion: number;
  readonly state: 'preview_ready';
  readonly candidateIdentity: {
    readonly providerNamespace: string;
    readonly placeId: string;
  };
  readonly ownerFields: CatalogIntakeOwnerFields;
  readonly titleProposal?: CatalogIntakeTitleProposal;
  readonly addressProposal?: CatalogIntakeAddressProposal;
  readonly clarification?: CatalogIntakeClarification;
  readonly locationEvidence: CatalogIntakeLocationEvidence;
  readonly tabelog: CatalogIntakeTabelogSnapshot;
  readonly reservation: CatalogIntakeReservationSnapshot;
  readonly suspectedDuplicates: readonly CatalogIntakeSuspectedDuplicate[];
  readonly unknownFields: readonly (
    | 'address'
    | 'coordinates'
    | 'tabelog'
    | 'reservation'
  )[];
  readonly warnings: readonly CatalogIntakeWarning[];
  readonly evidenceDigest: string;
  readonly catalogRevision: string;
  readonly expiresAt: string;
}

export type CatalogIntakeSelectOutput =
  | {
      readonly status: 'preview_ready';
      readonly sessionId: string;
      readonly sessionVersion: number;
      readonly preview: CatalogIntakePreview;
      readonly expiresAt: string;
    }
  | {
      readonly status: 'clarification_required';
      readonly sessionId: string;
      readonly sessionVersion: number;
      readonly clarification: CatalogIntakeClarification;
      readonly expiresAt: string;
    };

export interface CatalogIntakeConfirmInput {
  readonly sessionId: string;
  readonly expectedPreviewVersion: number;
}

export type CatalogIntakeConfirmOutput =
  | {
      readonly status:
        | 'committed_verified'
        | 'committed_needs_review'
        | 'reused_existing';
      readonly itemId: string;
      readonly receiptRef: string;
      readonly replayed: boolean;
    }
  | { readonly status: 'conflict'; readonly newPreview: CatalogIntakePreview }
  | {
      readonly status: 'failed_no_write';
      readonly reason: 'validation' | 'dependency' | 'transaction';
    };

export interface CatalogIntakeCancelInput {
  readonly sessionId: string;
  readonly expectedSessionVersion: number;
}

export interface CatalogIntakeCancelOutput {
  readonly status: 'cancelled';
  readonly sessionId: string;
  readonly replayed: boolean;
}

export interface CatalogIntakeStoredCandidate {
  readonly providerNamespace: string;
  readonly placeId: string;
  readonly ordinal: number;
  readonly createdAt: string;
}

interface CatalogIntakeActiveSessionBase extends CatalogIntakeScope {
  readonly ownerQuery: string;
  readonly normalizedOwnerQuery: string;
  readonly requestToken: string;
  readonly hasMore: boolean;
  readonly candidates: readonly CatalogIntakeStoredCandidate[];
  readonly catalogRevision: string;
  readonly createdAt: string;
  readonly discoverExpiresAt: string;
  readonly lastAcceptedActivityAt: string;
  readonly expiresAt: string;
  readonly researchPhaseDigests: {
    readonly initial: string;
    readonly confirm?: string;
  };
  readonly researchPhaseApplications?: {
    readonly confirm?: {
      readonly queryOrUrlsDigest: string;
      readonly appliedPreviewVersion: number;
    };
  };
  readonly lastTransition?: {
    readonly operation: 'select';
    readonly fromVersion: number;
    readonly inputJson: string;
    readonly clarification?: CatalogIntakeClarification;
  };
}

export interface CatalogIntakeCandidatesSession extends CatalogIntakeActiveSessionBase {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly state: 'candidates_ready';
}

export interface CatalogIntakePreviewSession extends CatalogIntakeActiveSessionBase {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly state: 'preview_ready';
  readonly preview: CatalogIntakePreview;
  readonly confirmMutationKey?: string;
}

export interface CatalogIntakeCancelledSession extends CatalogIntakeScope {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly state: 'cancelled';
  readonly cancelledFromVersion: number;
  readonly requestToken: string;
  readonly normalizedOwnerQuery: string;
  readonly terminalAt: string;
  readonly retainUntil: string;
}

export interface CatalogIntakeExpiredSession extends CatalogIntakeScope {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly state: 'expired';
  readonly expiredFromVersion: number;
  readonly expiredAt: string;
  readonly requestToken: string;
  readonly normalizedOwnerQuery: string;
  readonly terminalAt: string;
  readonly retainUntil: string;
}

export interface CatalogIntakeCommittedSession extends CatalogIntakeScope {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly state: 'committed';
  readonly committedFromVersion: number;
  readonly requestToken: string;
  readonly normalizedOwnerQuery: string;
  readonly terminalAt: string;
  readonly retainUntil: string;
  readonly mutationKey: string;
  readonly previewVersion: number;
  readonly evidenceDigest: string;
  readonly outcome: Extract<
    CatalogIntakeConfirmOutput,
    { readonly replayed: boolean }
  >;
}

export type CatalogIntakeStoredSession =
  | CatalogIntakeCandidatesSession
  | CatalogIntakePreviewSession
  | CatalogIntakeCommittedSession
  | CatalogIntakeCancelledSession
  | CatalogIntakeExpiredSession;

export interface CatalogIntakeStatePort {
  findByRequest(
    scope: CatalogIntakeScope,
    requestToken: string,
  ): Promise<CatalogIntakeStoredSession | undefined>;
  createReplacingActive(session: CatalogIntakeCandidatesSession): Promise<
    | {
        readonly kind: 'created';
        readonly session: CatalogIntakeCandidatesSession;
      }
    | { readonly kind: 'replay'; readonly session: CatalogIntakeStoredSession }
    | { readonly kind: 'conflict' }
  >;
  get(
    scope: CatalogIntakeScope,
    sessionId: string,
  ): Promise<CatalogIntakeStoredSession | undefined>;
  compareAndSwap(input: {
    readonly scope: CatalogIntakeScope;
    readonly sessionId: string;
    readonly expectedVersion: number;
    readonly next: CatalogIntakeStoredSession;
  }): Promise<
    | { readonly kind: 'applied'; readonly session: CatalogIntakeStoredSession }
    | {
        readonly kind: 'conflict';
        readonly current?: CatalogIntakeStoredSession;
      }
  >;
  consumeResearchPhase(input: {
    readonly scope: CatalogIntakeScope;
    readonly sessionId: string;
    readonly expectedSessionVersion: number;
    readonly phase: CatalogIntakeResearchPhase;
    readonly queryOrUrlsDigest: string;
    readonly requestId: string;
  }): Promise<
    | {
        readonly kind: 'consumed';
        readonly allowance: CatalogIntakeResearchAllowance;
      }
    | { readonly kind: 'already_spent' }
    | { readonly kind: 'expired' }
    | { readonly kind: 'conflict' }
  >;
  cleanup(now: Date): Promise<{
    readonly expired: number;
    readonly removed: number;
  }>;
}

export interface AtlasCatalogIntakePort {
  publish(
    preview: CatalogIntakePreview,
    mutationKey: string,
    expectedSessionVersion: number,
    catalogRevision: string,
  ): Promise<CatalogIntakeConfirmOutput>;
}

export interface CatalogIntakeModule {
  discover(
    input: CatalogIntakeDiscoverInput,
    scope: CatalogIntakeScope,
  ): Promise<AddResult<CatalogIntakeDiscoverOutput>>;
  select(
    input: CatalogIntakeSelectInput,
    scope: CatalogIntakeScope,
  ): Promise<AddResult<CatalogIntakeSelectOutput>>;
  confirm(
    input: CatalogIntakeConfirmInput,
    scope: CatalogIntakeScope,
  ): Promise<AddResult<CatalogIntakeConfirmOutput>>;
  cancel(
    input: CatalogIntakeCancelInput,
    scope: CatalogIntakeScope,
  ): Promise<AddResult<CatalogIntakeCancelOutput>>;
}

export function createCatalogIntakeModule(options: {
  readonly discoveryPort: GooglePlaceDiscoveryPort;
  readonly durableGeocoderPort?: DurableGeocoderPort;
  readonly webResearchPort?: WebResearchPort;
  readonly atlasCatalogIntakePort?: AtlasCatalogIntakePort;
  readonly statePort: CatalogIntakeStatePort;
  readonly clock: { now(): Date };
  readonly idSource: { nextId(): string };
  readonly catalogRevision: { read(): Promise<string> };
}): CatalogIntakeModule {
  return {
    async discover(input, scope) {
      try {
        const prior = await options.statePort.findByRequest(
          scope,
          input.requestToken,
        );
        if (prior) {
          if (prior.normalizedOwnerQuery !== input.query) {
            return addFailure(
              'conflict',
              'The request token was already used for another query.',
              false,
            );
          }
          if (
            prior.state !== 'candidates_ready' &&
            prior.state !== 'preview_ready'
          ) {
            return addFailure(
              prior.state === 'expired' ? 'expired' : 'conflict',
              prior.state === 'expired'
                ? 'Catalog intake session has expired.'
                : 'Catalog intake session is no longer active.',
              false,
            );
          }
          const expiration = await expireIfNeeded(prior, scope, options);
          if (expiration.kind === 'expired') {
            return addFailure(
              'expired',
              'Catalog intake session has expired.',
              false,
            );
          }
          if (expiration.kind !== 'active') {
            return addFailure(
              'conflict',
              'Catalog intake session has changed.',
              false,
            );
          }
          return replayDiscover(expiration.session, options.discoveryPort);
        }

        const discovered = await options.discoveryPort.discover({
          query: input.query,
        });
        if (!discovered.ok) {
          return addFailure(
            'dependency_failure',
            'Place discovery is temporarily unavailable.',
            true,
          );
        }
        const discovery = validateDiscoveryResult(discovered.value);
        if (!discovery) {
          return addFailure(
            'dependency_failure',
            'Place discovery returned an invalid response.',
            false,
          );
        }

        const now = options.clock.now();
        const sessionId = options.idSource.nextId();
        const expiresAt = acceptedExpiry(now);
        const catalogRevision = await options.catalogRevision.read();
        const session: CatalogIntakeCandidatesSession = {
          sessionId,
          sessionVersion: 1,
          state: 'candidates_ready',
          ...scope,
          ownerQuery: input.query,
          normalizedOwnerQuery: input.query,
          researchPhaseDigests: {
            initial: await deriveCatalogIntakeResearchInputDigest({
              phase: 'initial',
              normalizedOwnerQuery: input.query,
            }),
          },
          requestToken: input.requestToken,
          hasMore: discovery.hasMore,
          candidates: discovery.candidates.map(({ durableIdentity }) => ({
            ...durableIdentity,
            createdAt: now.toISOString(),
          })),
          catalogRevision,
          createdAt: now.toISOString(),
          discoverExpiresAt: expiresAt,
          lastAcceptedActivityAt: now.toISOString(),
          expiresAt,
        };
        const created = await options.statePort.createReplacingActive(session);
        if (created.kind === 'conflict') {
          return addFailure(
            'conflict',
            'The request token conflicts with an earlier request.',
            false,
          );
        }
        if (created.kind === 'replay') {
          if (
            created.session.normalizedOwnerQuery !== input.query ||
            (created.session.state !== 'candidates_ready' &&
              created.session.state !== 'preview_ready')
          ) {
            return addFailure(
              'conflict',
              'The request token conflicts with an earlier request.',
              false,
            );
          }
          const expiration = await expireIfNeeded(
            created.session,
            scope,
            options,
          );
          if (expiration.kind === 'expired') {
            return addFailure(
              'expired',
              'Catalog intake session has expired.',
              false,
            );
          }
          if (expiration.kind !== 'active') {
            return addFailure(
              'conflict',
              'Catalog intake session has changed.',
              false,
            );
          }
          return replayDiscover(expiration.session, options.discoveryPort);
        }

        return success({
          status:
            discovery.candidates.length === 0
              ? 'clarification_required'
              : 'candidates_ready',
          sessionId,
          sessionVersion: 1,
          candidates: discovery.candidates.map(
            ({ durableIdentity, transientPresentation }) => ({
              ordinal: durableIdentity.ordinal,
              transientName: transientPresentation.name,
              transientAddress: transientPresentation.address,
              attribution: transientPresentation.attribution,
            }),
          ),
          hasMore: discovery.hasMore,
          expiresAt,
        });
      } catch {
        return addFailure(
          'dependency_failure',
          'Catalog intake dependencies are temporarily unavailable.',
          true,
        );
      }
    },
    async select(input, scope) {
      try {
        let session = await options.statePort.get(scope, input.sessionId);
        if (!session) {
          return addFailure(
            'not_found',
            'Catalog intake session was not found.',
            false,
          );
        }
        if (session.state === 'expired') {
          return addFailure(
            'expired',
            'Catalog intake session has expired.',
            false,
          );
        }
        if (session.state === 'cancelled') {
          return addFailure(
            'conflict',
            'Catalog intake session is cancelled.',
            false,
          );
        }
        if (session.state === 'committed') {
          return addFailure(
            'conflict',
            'Catalog intake session is already committed.',
            false,
          );
        }
        const expiration = await expireIfNeeded(session, scope, options);
        if (expiration.kind === 'expired') {
          return addFailure(
            'expired',
            'Catalog intake session has expired.',
            false,
          );
        }
        if (expiration.kind !== 'active') {
          return addFailure(
            'conflict',
            'Catalog intake session has changed.',
            false,
          );
        }
        session = expiration.session;
        const inputJson = canonicalSelectInput(input);
        if (
          session.lastTransition?.operation === 'select' &&
          session.lastTransition.fromVersion === input.expectedSessionVersion
        ) {
          if (session.lastTransition.inputJson !== inputJson) {
            return addFailure(
              'conflict',
              'Catalog intake selection conflicts with an earlier request.',
              false,
            );
          }
          return replaySelect(session);
        }
        if (
          (session.state !== 'candidates_ready' &&
            session.state !== 'preview_ready') ||
          session.sessionVersion !== input.expectedSessionVersion
        ) {
          return addFailure(
            'conflict',
            'Catalog intake session has changed.',
            false,
          );
        }
        const candidate = session.candidates.find(
          ({ ordinal }) => ordinal === input.ordinal,
        );
        if (!candidate) {
          return addFailure(
            'not_found',
            'Catalog intake candidate was not found.',
            false,
          );
        }
        const refreshed = await options.discoveryPort.refetch({
          providerNamespace: candidate.providerNamespace,
          placeId: candidate.placeId,
        });
        if (!refreshed.ok) {
          return addFailure(
            'dependency_failure',
            'Place discovery is temporarily unavailable.',
            refreshed.error.kind !== 'not_found',
          );
        }
        const refreshedCandidate = validateDiscoveryCandidate(refreshed.value);
        if (
          !refreshedCandidate ||
          refreshedCandidate.durableIdentity.providerNamespace !==
            candidate.providerNamespace ||
          refreshedCandidate.durableIdentity.placeId !== candidate.placeId
        ) {
          return addFailure(
            'dependency_failure',
            'Place discovery returned an invalid response.',
            false,
          );
        }

        const ownerFields = input.ownerFields ?? {};
        const acceptedAt = options.clock.now();
        const nextVersion = session.sessionVersion + 1;
        let geocoderOutcome: DurableGeocoderProposal | undefined;
        let geocoderUnavailable = !options.durableGeocoderPort;
        if (
          !ownerFields.address &&
          !ownerFields.coordinates &&
          options.durableGeocoderPort
        ) {
          const proposed = await options.durableGeocoderPort.propose({
            trigger: 'owner_intake_select',
            dataClassification: 'public_place_query',
            ownerQuery: session.ownerQuery,
            ownerDraft: ownerFields,
          });
          if (proposed.ok) {
            geocoderOutcome = validateDurableGeocoderProposal(proposed.value);
            geocoderUnavailable = !geocoderOutcome;
          } else {
            geocoderUnavailable = true;
          }
        }
        const geocoderProposal =
          geocoderOutcome?.status === 'resolved' ? geocoderOutcome : undefined;
        const clarification =
          geocoderOutcome?.status === 'ambiguous'
            ? ({
                code: 'ambiguous_location' as const,
                prompt: 'Add an area or address to identify the right place.',
                fields: ['area', 'address'] as const,
              } satisfies CatalogIntakeClarification)
            : undefined;
        if (clarification) {
          const next: CatalogIntakeCandidatesSession = {
            ...session,
            state: 'candidates_ready',
            sessionVersion: nextVersion,
            lastAcceptedActivityAt: acceptedAt.toISOString(),
            expiresAt: acceptedExpiry(acceptedAt),
            lastTransition: {
              operation: 'select',
              fromVersion: input.expectedSessionVersion,
              inputJson,
              clarification,
            },
          };
          const transitioned = await options.statePort.compareAndSwap({
            scope,
            sessionId: session.sessionId,
            expectedVersion: input.expectedSessionVersion,
            next,
          });
          if (transitioned.kind === 'conflict') {
            if (
              await rejectedActiveCasExpired(
                transitioned.current,
                scope,
                options,
              )
            ) {
              return addFailure(
                'expired',
                'Catalog intake session has expired.',
                false,
              );
            }
            return replayOrConflictSelect(
              transitioned.current,
              input,
              inputJson,
            );
          }
          return success({
            status: 'clarification_required',
            sessionId: session.sessionId,
            sessionVersion: nextVersion,
            clarification,
            expiresAt: next.expiresAt,
          });
        }

        const assertedAt = acceptedAt.toISOString();
        const titleProposal = !ownerFields.title
          ? ({
              provenance: 'owner_query' as const,
              value: session.ownerQuery,
            } satisfies CatalogIntakeTitleProposal)
          : undefined;
        const addressProposal = geocoderProposal
          ? ({
              provenance: 'durable_geocoder_observed' as const,
              value: geocoderProposal.normalizedAddress,
              sourceUrl: geocoderProposal.sourceUrl,
              license: geocoderProposal.license,
              checkedAt: geocoderProposal.checkedAt,
            } satisfies CatalogIntakeAddressProposal)
          : undefined;
        const locationEvidence =
          ownerFields.coordinates && ownerFields.address
            ? {
                status: 'known' as const,
                provenance: 'owner_asserted' as const,
                address: ownerFields.address,
                ...ownerFields.coordinates,
                assertedAt,
              }
            : geocoderProposal
              ? {
                  status: 'known' as const,
                  provenance: 'durable_geocoder_observed' as const,
                  normalizedAddress: geocoderProposal.normalizedAddress,
                  latitude: geocoderProposal.latitude,
                  longitude: geocoderProposal.longitude,
                  provider: geocoderProposal.provider,
                  sourceUrl: geocoderProposal.sourceUrl,
                  license: geocoderProposal.license,
                  checkedAt: geocoderProposal.checkedAt,
                }
              : { status: 'unknown' as const };
        const ownerTabelog =
          input.tabelog && input.tabelog !== 'unknown'
            ? {
                status: 'known' as const,
                ...input.tabelog,
                provenance: 'owner_asserted' as const,
                assertedAt,
                freshness: 'fresh' as const,
              }
            : input.tabelog === undefined && session.state === 'preview_ready'
              ? session.preview.tabelog
              : { status: 'unknown' as const };
        const ownerReservation =
          input.reservation && input.reservation !== 'unknown'
            ? {
                status: 'known' as const,
                ...input.reservation,
                provenance: 'owner_asserted' as const,
                assertedAt,
                freshness: 'fresh' as const,
              }
            : input.reservation === undefined &&
                session.state === 'preview_ready'
              ? session.preview.reservation
              : { status: 'unknown' as const };
        let researched: {
          readonly tabelog: CatalogIntakeTabelogSnapshot;
          readonly reservation: CatalogIntakeReservationSnapshot;
        } = {
          tabelog: { status: 'unknown' as const },
          reservation: { status: 'unknown' as const },
        };
        let researchUnavailable = false;
        if (
          input.requestResearch &&
          session.state === 'candidates_ready' &&
          options.webResearchPort
        ) {
          const research = await options.webResearchPort.research({
            phase: 'initial',
            scope,
            sessionId: session.sessionId,
            expectedSessionVersion: session.sessionVersion,
            queryOrUrlsDigest: session.researchPhaseDigests.initial,
            normalizedOwnerQuery: session.normalizedOwnerQuery,
          });
          if (research.kind === 'expired') {
            return addFailure(
              'expired',
              'Catalog intake session has expired.',
              false,
            );
          }
          if (research.kind === 'conflict') {
            return addFailure(
              'conflict',
              'Catalog intake session has changed.',
              false,
            );
          }
          if (research.kind !== 'observed') {
            researchUnavailable = true;
          } else {
            const normalizedResearch = validateWebResearchOutput(
              research.value,
              { tabelog: ownerTabelog, reservation: ownerReservation },
            );
            if (!normalizedResearch) {
              return addFailure(
                'dependency_failure',
                'Web research returned an invalid response.',
                false,
              );
            }
            researched = normalizedResearch;
          }
        }
        const tabelog =
          ownerTabelog.status === 'known'
            ? ownerTabelog
            : researched.tabelog.status === 'known'
              ? researched.tabelog
              : ownerTabelog;
        const reservation =
          ownerReservation.status === 'known'
            ? ownerReservation
            : researched.reservation.status === 'known'
              ? researched.reservation
              : ownerReservation;
        const previewWithoutDigest = {
          sessionId: session.sessionId,
          previewVersion:
            session.state === 'preview_ready'
              ? session.preview.previewVersion + 1
              : 1,
          state: 'preview_ready' as const,
          candidateIdentity: {
            providerNamespace: candidate.providerNamespace,
            placeId: candidate.placeId,
          },
          ownerFields,
          ...(titleProposal ? { titleProposal } : {}),
          ...(addressProposal ? { addressProposal } : {}),
          locationEvidence,
          tabelog,
          reservation,
          suspectedDuplicates: [] as const,
          unknownFields: [
            ...(!ownerFields.address && !addressProposal
              ? (['address'] as const)
              : []),
            ...(locationEvidence.status === 'unknown'
              ? (['coordinates'] as const)
              : []),
            ...(tabelog.status === 'unknown' ? (['tabelog'] as const) : []),
            ...(reservation.status === 'unknown'
              ? (['reservation'] as const)
              : []),
          ],
          warnings: canonicalizeCatalogIntakeWarnings([
            ...(geocoderUnavailable || researchUnavailable
              ? ([
                  {
                    code: 'provider_unavailable' as const,
                    message: geocoderUnavailable
                      ? 'Durable location lookup is unavailable; review the owner-provided details.'
                      : 'Web research is unavailable; review the owner-provided details.',
                  },
                ] as const)
              : []),
            {
              code: 'needs_review' as const,
              message:
                'Confirm or complete the durable place details before publishing.',
            },
          ]),
          catalogRevision: session.catalogRevision,
          expiresAt: acceptedExpiry(acceptedAt),
        };
        const preview: CatalogIntakePreview = {
          ...previewWithoutDigest,
          evidenceDigest: await digestCanonical(previewWithoutDigest),
        };
        const next: CatalogIntakePreviewSession = {
          ...session,
          state: 'preview_ready',
          sessionVersion: nextVersion,
          lastAcceptedActivityAt: acceptedAt.toISOString(),
          expiresAt: preview.expiresAt,
          lastTransition: {
            operation: 'select',
            fromVersion: input.expectedSessionVersion,
            inputJson,
          },
          preview,
          researchPhaseDigests: await researchPhaseDigestsForPreview(
            session,
            preview,
          ),
        };
        const transitioned = await options.statePort.compareAndSwap({
          scope,
          sessionId: session.sessionId,
          expectedVersion: input.expectedSessionVersion,
          next,
        });
        if (transitioned.kind === 'conflict') {
          if (
            await rejectedActiveCasExpired(transitioned.current, scope, options)
          ) {
            return addFailure(
              'expired',
              'Catalog intake session has expired.',
              false,
            );
          }
          return replayOrConflictSelect(transitioned.current, input, inputJson);
        }
        return success({
          status: 'preview_ready',
          sessionId: session.sessionId,
          sessionVersion: nextVersion,
          preview,
          expiresAt: next.expiresAt,
        });
      } catch {
        return addFailure(
          'dependency_failure',
          'Catalog intake state is temporarily unavailable.',
          true,
        );
      }
    },
    async confirm(input, scope) {
      try {
        let session = await options.statePort.get(scope, input.sessionId);
        if (!session) {
          return addFailure(
            'not_found',
            'Catalog intake session was not found.',
            false,
          );
        }
        if (session.state === 'expired') {
          return addFailure(
            'expired',
            'Catalog intake session has expired.',
            false,
          );
        }
        if (session.state === 'cancelled') {
          return addFailure(
            'conflict',
            'Catalog intake session is cancelled.',
            false,
          );
        }
        if (session.state === 'committed') {
          if (session.previewVersion !== input.expectedPreviewVersion) {
            return addFailure(
              'conflict',
              'Catalog intake preview has changed.',
              false,
            );
          }
          const replayKey = await deriveAddConfirmMutationKeyFromParts(
            scope,
            session.sessionId,
            session.previewVersion,
            session.evidenceDigest,
          );
          return replayKey === session.mutationKey
            ? success({ ...session.outcome, replayed: true })
            : addFailure(
                'conflict',
                'Catalog intake confirmation conflicts with the committed receipt.',
                false,
              );
        }
        const expiration = await expireIfNeeded(session, scope, options);
        if (expiration.kind === 'expired') {
          return addFailure(
            'expired',
            'Catalog intake session has expired.',
            false,
          );
        }
        if (expiration.kind !== 'active') {
          return addFailure(
            'conflict',
            'Catalog intake session has changed.',
            false,
          );
        }
        session = expiration.session;
        if (
          session.state !== 'preview_ready' ||
          session.preview.previewVersion !== input.expectedPreviewVersion
        ) {
          return addFailure(
            'conflict',
            'Catalog intake preview has changed.',
            false,
          );
        }
        const identityRefresh = await options.discoveryPort.refetch({
          providerNamespace:
            session.preview.candidateIdentity.providerNamespace,
          placeId: session.preview.candidateIdentity.placeId,
        });
        if (!identityRefresh.ok) {
          return success({
            status: 'failed_no_write',
            reason: 'dependency',
          });
        }
        const refreshedCandidate = validateDiscoveryCandidate(
          identityRefresh.value,
        );
        if (!refreshedCandidate) {
          return success({
            status: 'failed_no_write',
            reason: 'dependency',
          });
        }
        if (
          refreshedCandidate.durableIdentity.providerNamespace !==
            session.preview.candidateIdentity.providerNamespace ||
          refreshedCandidate.durableIdentity.placeId !==
            session.preview.candidateIdentity.placeId
        ) {
          const acceptedAt = options.clock.now();
          const { evidenceDigest: _priorDigest, ...priorWithoutDigest } =
            session.preview;
          const previewWithoutDigest = {
            ...priorWithoutDigest,
            previewVersion: session.preview.previewVersion + 1,
            candidateIdentity: {
              providerNamespace:
                refreshedCandidate.durableIdentity.providerNamespace,
              placeId: refreshedCandidate.durableIdentity.placeId,
            },
            expiresAt: acceptedExpiry(acceptedAt),
          };
          const newPreview: CatalogIntakePreview = {
            ...previewWithoutDigest,
            evidenceDigest: await digestCanonical(previewWithoutDigest),
          };
          const next: CatalogIntakePreviewSession = {
            ...session,
            sessionVersion: session.sessionVersion + 1,
            lastAcceptedActivityAt: acceptedAt.toISOString(),
            expiresAt: newPreview.expiresAt,
            preview: newPreview,
            researchPhaseDigests: await researchPhaseDigestsForPreview(
              session,
              newPreview,
            ),
          };
          const transitioned = await options.statePort.compareAndSwap({
            scope,
            sessionId: session.sessionId,
            expectedVersion: session.sessionVersion,
            next,
          });
          if (
            transitioned.kind === 'conflict' &&
            (await rejectedActiveCasExpired(
              transitioned.current,
              scope,
              options,
            ))
          ) {
            return addFailure(
              'expired',
              'Catalog intake session has expired.',
              false,
            );
          }
          return transitioned.kind === 'applied'
            ? success({ status: 'conflict', newPreview })
            : addFailure(
                'conflict',
                'Catalog intake preview has changed.',
                false,
              );
        }
        let refreshedAddress = session.preview.addressProposal;
        let refreshedLocation = session.preview.locationEvidence;
        let refreshedTabelog = session.preview.tabelog;
        let refreshedReservation = session.preview.reservation;
        let providerRefreshFailed = false;
        if (options.durableGeocoderPort) {
          const geocoderRefresh = await options.durableGeocoderPort.propose({
            trigger: 'owner_intake_confirm',
            dataClassification: 'public_place_query',
            ownerQuery: session.ownerQuery,
            ownerDraft: session.preview.ownerFields,
          });
          if (!geocoderRefresh.ok) {
            return success({
              status: 'failed_no_write',
              reason: 'dependency',
            });
          }
          const proposal = validateDurableGeocoderProposal(
            geocoderRefresh.value,
          );
          if (!proposal) {
            return success({
              status: 'failed_no_write',
              reason: 'dependency',
            });
          }
          const resolved =
            proposal?.status === 'resolved' ? proposal : undefined;
          const priorLocation = session.preview.locationEvidence;
          const lostDurableGeocoderMatch =
            proposal.status === 'no_match' &&
            priorLocation.status === 'known' &&
            priorLocation.provenance === 'durable_geocoder_observed';
          const canUseGeocoder =
            priorLocation.status === 'unknown' ||
            priorLocation.provenance === 'durable_geocoder_observed';
          const sameResolvedFacts =
            resolved &&
            priorLocation.status === 'known' &&
            priorLocation.provenance === 'durable_geocoder_observed' &&
            priorLocation.normalizedAddress === resolved.normalizedAddress &&
            priorLocation.latitude === resolved.latitude &&
            priorLocation.longitude === resolved.longitude &&
            priorLocation.provider === resolved.provider &&
            priorLocation.sourceUrl === resolved.sourceUrl &&
            priorLocation.license === resolved.license;
          refreshedAddress = lostDurableGeocoderMatch
            ? undefined
            : resolved && canUseGeocoder
              ? sameResolvedFacts
                ? session.preview.addressProposal
                : {
                    provenance: 'durable_geocoder_observed' as const,
                    value: resolved.normalizedAddress,
                    sourceUrl: resolved.sourceUrl,
                    license: resolved.license,
                    checkedAt: resolved.checkedAt,
                  }
              : session.preview.addressProposal;
          refreshedLocation = lostDurableGeocoderMatch
            ? { status: 'unknown' as const }
            : resolved && canUseGeocoder
              ? sameResolvedFacts
                ? priorLocation
                : {
                    status: 'known' as const,
                    provenance: 'durable_geocoder_observed' as const,
                    normalizedAddress: resolved.normalizedAddress,
                    latitude: resolved.latitude,
                    longitude: resolved.longitude,
                    provider: resolved.provider,
                    sourceUrl: resolved.sourceUrl,
                    license: resolved.license,
                    checkedAt: resolved.checkedAt,
                  }
              : priorLocation;
          providerRefreshFailed ||= proposal.status === 'ambiguous';
        }
        const canonicalResearchUrls = catalogIntakeCanonicalResearchUrls(
          session.preview,
        );
        const confirmResearchDigest = session.researchPhaseDigests.confirm;
        const appliedConfirm = session.researchPhaseApplications?.confirm;
        const confirmResearchAlreadyApplied = Boolean(
          confirmResearchDigest &&
          appliedConfirm?.queryOrUrlsDigest === confirmResearchDigest &&
          appliedConfirm.appliedPreviewVersion ===
            session.preview.previewVersion,
        );
        let confirmResearchAttempted = false;
        let confirmResearchApplied = false;
        if (
          options.webResearchPort &&
          confirmResearchDigest &&
          canonicalResearchUrls.length > 0 &&
          !confirmResearchAlreadyApplied
        ) {
          confirmResearchAttempted = true;
          const research = await options.webResearchPort.research({
            phase: 'confirm',
            scope,
            sessionId: session.sessionId,
            expectedSessionVersion: session.sessionVersion,
            queryOrUrlsDigest: confirmResearchDigest,
            canonicalUrls: canonicalResearchUrls,
            preview: session.preview,
          });
          if (research.kind === 'expired') {
            return addFailure(
              'expired',
              'Catalog intake session has expired.',
              false,
            );
          }
          if (research.kind === 'conflict') {
            return addFailure(
              'conflict',
              'Catalog intake session has changed.',
              false,
            );
          }
          if (research.kind !== 'observed') {
            providerRefreshFailed = true;
            refreshedTabelog = markAgentTabelogStale(session.preview.tabelog);
            refreshedReservation = markAgentReservationStale(
              session.preview.reservation,
            );
          } else {
            const normalizedResearch = validateWebResearchOutput(
              research.value,
              session.preview,
            );
            if (!normalizedResearch) {
              return success({
                status: 'failed_no_write',
                reason: 'dependency',
              });
            }
            confirmResearchApplied = true;
            const stableResearch = stabilizeResearchEvidence(
              normalizedResearch,
              session.preview,
            );
            refreshedTabelog = stableResearch.tabelog;
            refreshedReservation = stableResearch.reservation;
          }
        }
        const providerRefreshEnabled = Boolean(
          options.durableGeocoderPort || confirmResearchAttempted,
        );
        const refreshedWarnings = !providerRefreshEnabled
          ? session.preview.warnings
          : providerRefreshFailed
            ? withConfirmProviderUnavailableWarning(
                session.preview.warnings,
                hasStaleAgentEvidence(refreshedTabelog, refreshedReservation),
              )
            : withoutRefreshFailureWarnings(session.preview.warnings);
        if (
          canonicalJson(refreshedAddress) !==
            canonicalJson(session.preview.addressProposal) ||
          canonicalJson(refreshedLocation) !==
            canonicalJson(session.preview.locationEvidence) ||
          canonicalJson(refreshedTabelog) !==
            canonicalJson(session.preview.tabelog) ||
          canonicalJson(refreshedReservation) !==
            canonicalJson(session.preview.reservation) ||
          canonicalJson(refreshedWarnings) !==
            canonicalJson(session.preview.warnings)
        ) {
          const acceptedAt = options.clock.now();
          const {
            evidenceDigest: _priorDigest,
            addressProposal: _priorAddress,
            ...priorWithoutDigest
          } = session.preview;
          const previewWithoutDigest = {
            ...priorWithoutDigest,
            previewVersion: session.preview.previewVersion + 1,
            ...(refreshedAddress ? { addressProposal: refreshedAddress } : {}),
            locationEvidence: refreshedLocation,
            tabelog: refreshedTabelog,
            reservation: refreshedReservation,
            unknownFields: [
              ...(!session.preview.ownerFields.address && !refreshedAddress
                ? (['address'] as const)
                : []),
              ...(refreshedLocation.status === 'unknown'
                ? (['coordinates'] as const)
                : []),
              ...(refreshedTabelog.status === 'unknown'
                ? (['tabelog'] as const)
                : []),
              ...(refreshedReservation.status === 'unknown'
                ? (['reservation'] as const)
                : []),
            ],
            warnings: refreshedWarnings,
            expiresAt: acceptedExpiry(acceptedAt),
          };
          const newPreview: CatalogIntakePreview = {
            ...previewWithoutDigest,
            evidenceDigest: await digestCanonical(previewWithoutDigest),
          };
          const nextResearchPhaseDigests = await researchPhaseDigestsForPreview(
            session,
            newPreview,
          );
          const next: CatalogIntakePreviewSession = {
            ...session,
            sessionVersion: session.sessionVersion + 1,
            lastAcceptedActivityAt: acceptedAt.toISOString(),
            expiresAt: newPreview.expiresAt,
            preview: newPreview,
            researchPhaseDigests: nextResearchPhaseDigests,
            ...(confirmResearchApplied && nextResearchPhaseDigests.confirm
              ? {
                  researchPhaseApplications: {
                    ...session.researchPhaseApplications,
                    confirm: {
                      queryOrUrlsDigest: nextResearchPhaseDigests.confirm,
                      appliedPreviewVersion: newPreview.previewVersion,
                    },
                  },
                }
              : {}),
          };
          const transitioned = await options.statePort.compareAndSwap({
            scope,
            sessionId: session.sessionId,
            expectedVersion: session.sessionVersion,
            next,
          });
          if (
            transitioned.kind === 'conflict' &&
            (await rejectedActiveCasExpired(
              transitioned.current,
              scope,
              options,
            ))
          ) {
            return addFailure(
              'expired',
              'Catalog intake session has expired.',
              false,
            );
          }
          return transitioned.kind === 'applied'
            ? success({ status: 'conflict', newPreview })
            : addFailure(
                'conflict',
                'Catalog intake preview has changed.',
                false,
              );
        }
        if (
          confirmResearchApplied &&
          confirmResearchDigest &&
          !confirmResearchAlreadyApplied
        ) {
          const markedSession: CatalogIntakePreviewSession = {
            ...session,
            sessionVersion: session.sessionVersion + 1,
            researchPhaseApplications: {
              ...session.researchPhaseApplications,
              confirm: {
                queryOrUrlsDigest: confirmResearchDigest,
                appliedPreviewVersion: session.preview.previewVersion,
              },
            },
          };
          const marked = await options.statePort.compareAndSwap({
            scope,
            sessionId: session.sessionId,
            expectedVersion: session.sessionVersion,
            next: markedSession,
          });
          if (marked.kind !== 'applied') {
            if (
              await rejectedActiveCasExpired(marked.current, scope, options)
            ) {
              return addFailure(
                'expired',
                'Catalog intake session has expired.',
                false,
              );
            }
            return addFailure(
              'conflict',
              'Catalog intake preview has changed.',
              false,
            );
          }
          session = markedSession;
        }
        if (options.atlasCatalogIntakePort) {
          const mutationKey = await deriveAddConfirmMutationKey(
            scope,
            session.preview,
          );
          if (session.confirmMutationKey !== mutationKey) {
            const claimedSession: CatalogIntakePreviewSession = {
              ...session,
              sessionVersion: session.sessionVersion + 1,
              confirmMutationKey: mutationKey,
            };
            const claimed = await options.statePort.compareAndSwap({
              scope,
              sessionId: session.sessionId,
              expectedVersion: session.sessionVersion,
              next: claimedSession,
            });
            if (claimed.kind !== 'applied') {
              if (
                await rejectedActiveCasExpired(claimed.current, scope, options)
              ) {
                return addFailure(
                  'expired',
                  'Catalog intake session has expired.',
                  false,
                );
              }
              return addFailure(
                'conflict',
                'Catalog intake preview has changed.',
                false,
              );
            }
            session = claimedSession;
          }
          return success(
            await options.atlasCatalogIntakePort.publish(
              session.preview,
              mutationKey,
              session.sessionVersion,
              session.catalogRevision,
            ),
          );
        }
        return success({
          status: 'failed_no_write',
          reason: 'dependency',
        });
      } catch {
        return addFailure(
          'dependency_failure',
          'Catalog intake state is temporarily unavailable.',
          true,
        );
      }
    },
    async cancel(input, scope) {
      try {
        let session = await options.statePort.get(scope, input.sessionId);
        if (!session) {
          return addFailure(
            'not_found',
            'Catalog intake session was not found.',
            false,
          );
        }
        if (session.state === 'cancelled') {
          return session.cancelledFromVersion === input.expectedSessionVersion
            ? success({
                status: 'cancelled',
                sessionId: session.sessionId,
                replayed: true,
              })
            : addFailure(
                'conflict',
                'Catalog intake session has changed.',
                false,
              );
        }
        if (session.state === 'expired') {
          return addFailure(
            'expired',
            'Catalog intake session has expired.',
            false,
          );
        }
        if (session.state === 'committed') {
          return addFailure(
            'conflict',
            'Catalog intake session is already committed.',
            false,
          );
        }
        const expiration = await expireIfNeeded(session, scope, options);
        if (expiration.kind === 'expired') {
          return addFailure(
            'expired',
            'Catalog intake session has expired.',
            false,
          );
        }
        if (expiration.kind === 'cancelled') {
          return expiration.session.cancelledFromVersion ===
            input.expectedSessionVersion
            ? success({
                status: 'cancelled',
                sessionId: expiration.session.sessionId,
                replayed: true,
              })
            : addFailure(
                'conflict',
                'Catalog intake session has changed.',
                false,
              );
        }
        if (expiration.kind !== 'active') {
          return addFailure(
            'conflict',
            'Catalog intake session has changed.',
            false,
          );
        }
        session = expiration.session;
        if (session.sessionVersion !== input.expectedSessionVersion) {
          return addFailure(
            'conflict',
            'Catalog intake session has changed.',
            false,
          );
        }
        const terminalAt = options.clock.now();
        const next: CatalogIntakeCancelledSession = {
          state: 'cancelled',
          sessionId: session.sessionId,
          sessionVersion: session.sessionVersion + 1,
          ...scope,
          cancelledFromVersion: input.expectedSessionVersion,
          requestToken: session.requestToken,
          normalizedOwnerQuery: session.normalizedOwnerQuery,
          terminalAt: terminalAt.toISOString(),
          retainUntil: receiptRetention(terminalAt),
        };
        const transitioned = await options.statePort.compareAndSwap({
          scope,
          sessionId: session.sessionId,
          expectedVersion: input.expectedSessionVersion,
          next,
        });
        if (transitioned.kind === 'conflict') {
          const current = transitioned.current;
          if (await rejectedActiveCasExpired(current, scope, options)) {
            return addFailure(
              'expired',
              'Catalog intake session has expired.',
              false,
            );
          }
          if (
            current?.state === 'cancelled' &&
            current.cancelledFromVersion === input.expectedSessionVersion
          ) {
            return success({
              status: 'cancelled',
              sessionId: current.sessionId,
              replayed: true,
            });
          }
          return addFailure(
            'conflict',
            'Catalog intake session has changed.',
            false,
          );
        }
        return success({
          status: 'cancelled',
          sessionId: session.sessionId,
          replayed: false,
        });
      } catch {
        return addFailure(
          'dependency_failure',
          'Catalog intake state is temporarily unavailable.',
          true,
        );
      }
    },
  };
}

export function createUnavailableCatalogIntakeModule(): CatalogIntakeModule {
  const unavailable = () =>
    Promise.resolve(
      addFailure(
        'dependency_failure',
        'Catalog intake is not configured in this deployment.',
        true,
      ),
    );
  return {
    discover: unavailable,
    select: unavailable,
    confirm: unavailable,
    cancel: unavailable,
  };
}

export function createCatalogIntakeOperationGroup(module: CatalogIntakeModule) {
  const discover: OperationDefinition<
    'catalog.intake.discover',
    CatalogIntakeDiscoverInput,
    CatalogIntakeDiscoverOutput,
    'json'
  > = {
    descriptor: {
      key: 'catalog.intake.discover',
      resultKind: 'json',
      effect: 'write',
      validate: validateDiscoverInput,
    },
    handle: (input, context) =>
      executeWithScope(context, (scope) => module.discover(input, scope)),
  };

  const select: OperationDefinition<
    'catalog.intake.select',
    CatalogIntakeSelectInput,
    CatalogIntakeSelectOutput,
    'json'
  > = {
    descriptor: {
      key: 'catalog.intake.select',
      resultKind: 'json',
      effect: 'write',
      validate: validateSelectInput,
    },
    handle: (input, context) =>
      executeWithScope(context, (scope) => module.select(input, scope)),
  };

  const confirm: OperationDefinition<
    'catalog.intake.confirm',
    CatalogIntakeConfirmInput,
    CatalogIntakeConfirmOutput,
    'json'
  > = {
    descriptor: {
      key: 'catalog.intake.confirm',
      resultKind: 'json',
      effect: 'write',
      validate: validateConfirmInput,
    },
    handle: (input, context) =>
      executeWithScope(context, (scope) => module.confirm(input, scope)),
  };

  const cancel: OperationDefinition<
    'catalog.intake.cancel',
    CatalogIntakeCancelInput,
    CatalogIntakeCancelOutput,
    'json'
  > = {
    descriptor: {
      key: 'catalog.intake.cancel',
      resultKind: 'json',
      effect: 'write',
      validate: validateCancelInput,
    },
    handle: (input, context) =>
      executeWithScope(context, (scope) => module.cancel(input, scope)),
  };

  return defineOperationGroup({
    'catalog.intake.discover': discover,
    'catalog.intake.select': select,
    'catalog.intake.confirm': confirm,
    'catalog.intake.cancel': cancel,
  });
}

export function createInMemoryCatalogIntakeStatePort(
  clock: { now(): Date } = { now: () => new Date() },
): CatalogIntakeStatePort {
  const sessions = new Map<string, CatalogIntakeStoredSession>();
  const researchSpends = new Set<string>();
  return {
    async findByRequest(scope, requestToken) {
      const session = [...sessions.values()].find(
        (candidate) =>
          sameScope(candidate, scope) &&
          candidate.requestToken === requestToken,
      );
      return session ? structuredClone(session) : undefined;
    },
    async createReplacingActive(session) {
      const priorRequest = [...sessions.values()].find(
        (candidate) =>
          sameScope(candidate, session) &&
          candidate.requestToken === session.requestToken,
      );
      if (priorRequest) {
        return priorRequest.normalizedOwnerQuery ===
          session.normalizedOwnerQuery
          ? { kind: 'replay' as const, session: structuredClone(priorRequest) }
          : { kind: 'conflict' as const };
      }
      for (const [id, active] of sessions) {
        if (
          sameScope(active, session) &&
          (active.state === 'candidates_ready' ||
            active.state === 'preview_ready')
        ) {
          const terminalAt = new Date(session.createdAt);
          sessions.set(id, {
            state: 'cancelled',
            sessionId: active.sessionId,
            sessionVersion: active.sessionVersion + 1,
            ownerId: active.ownerId,
            channel: active.channel,
            conversationId: active.conversationId,
            cancelledFromVersion: active.sessionVersion,
            requestToken: active.requestToken,
            normalizedOwnerQuery: active.normalizedOwnerQuery,
            terminalAt: terminalAt.toISOString(),
            retainUntil: receiptRetention(terminalAt),
          });
        }
      }
      sessions.set(session.sessionId, structuredClone(session));
      return { kind: 'created' as const, session: structuredClone(session) };
    },
    async get(scope, sessionId) {
      const session = sessions.get(sessionId);
      return session && sameScope(session, scope)
        ? structuredClone(session)
        : undefined;
    },
    async compareAndSwap({ scope, sessionId, expectedVersion, next }) {
      const current = sessions.get(sessionId);
      if (
        !current ||
        !sameScope(current, scope) ||
        current.sessionVersion !== expectedVersion
      ) {
        return {
          kind: 'conflict' as const,
          ...(current && sameScope(current, scope)
            ? { current: structuredClone(current) }
            : {}),
        };
      }
      if (
        current.state === 'candidates_ready' ||
        current.state === 'preview_ready'
      ) {
        const expired = clock.now().getTime() >= Date.parse(current.expiresAt);
        if ((next.state === 'expired') !== expired) {
          return {
            kind: 'conflict' as const,
            current: structuredClone(current),
          };
        }
      }
      sessions.set(sessionId, structuredClone(next));
      return { kind: 'applied' as const, session: structuredClone(next) };
    },
    async consumeResearchPhase(input) {
      const session = sessions.get(input.sessionId);
      if (
        !session ||
        !sameScope(session, input.scope) ||
        session.sessionVersion !== input.expectedSessionVersion ||
        (session.state !== 'candidates_ready' &&
          session.state !== 'preview_ready') ||
        (input.phase === 'initial' && session.state !== 'candidates_ready') ||
        (input.phase === 'confirm' && session.state !== 'preview_ready')
      ) {
        return { kind: 'conflict' as const };
      }
      if (
        session.researchPhaseDigests[input.phase] !== input.queryOrUrlsDigest
      ) {
        return { kind: 'conflict' as const };
      }
      const now = clock.now();
      if (now.getTime() >= Date.parse(session.expiresAt)) {
        return { kind: 'expired' as const };
      }
      const spendKey = `${input.sessionId}:${input.phase}`;
      if (researchSpends.has(spendKey)) {
        return { kind: 'already_spent' as const };
      }
      researchSpends.add(spendKey);
      const budget = catalogIntakeResearchBudgets[input.phase];
      return {
        kind: 'consumed' as const,
        allowance: {
          sessionId: input.sessionId,
          phase: input.phase,
          queryOrUrlsDigest: input.queryOrUrlsDigest,
          maxCounts: {
            searchQueries: budget.searchQueries,
            pageRequests: budget.pageRequests,
          },
          maxDurationMs: budget.maxDurationMs,
          requestTimeoutMs: 15_000,
          maxRedirects: 3,
          deadline: new Date(
            Math.min(
              now.getTime() + budget.maxDurationMs,
              Date.parse(session.expiresAt),
            ),
          ).toISOString(),
          requestId: input.requestId,
        },
      };
    },
    async cleanup(now) {
      let expired = 0;
      let removed = 0;
      for (const [id, session] of sessions) {
        if (
          (session.state === 'candidates_ready' ||
            session.state === 'preview_ready') &&
          now.getTime() >= Date.parse(session.expiresAt)
        ) {
          sessions.set(id, expiredSession(session, now));
          expired += 1;
          continue;
        }
        if (
          (session.state === 'committed' ||
            session.state === 'cancelled' ||
            session.state === 'expired') &&
          now.getTime() >= Date.parse(session.retainUntil)
        ) {
          sessions.delete(id);
          removed += 1;
        }
      }
      return { expired, removed };
    },
  };
}

function executeWithScope<T>(
  context: ApplicationExecutionContext | undefined,
  execute: (scope: CatalogIntakeScope) => Promise<AddResult<T>>,
): Promise<AddResult<T>> {
  const invocation = context?.invocation;
  if (
    !invocation ||
    !normalizeBoundedText(invocation.ownerId, 1, 200) ||
    !normalizeBoundedText(invocation.channel, 1, 120) ||
    !normalizeBoundedText(invocation.conversationId, 1, 200)
  ) {
    return Promise.resolve(
      addFailure(
        'unauthorized',
        'Catalog intake requires an authenticated conversation.',
        false,
      ),
    );
  }
  return execute({
    ownerId: invocation.ownerId.normalize('NFC').trim(),
    channel: invocation.channel.normalize('NFC').trim(),
    conversationId: invocation.conversationId.normalize('NFC').trim(),
  });
}

async function replayDiscover(
  session: CatalogIntakeCandidatesSession | CatalogIntakePreviewSession,
  discoveryPort: GooglePlaceDiscoveryPort,
): Promise<AddResult<CatalogIntakeDiscoverOutput>> {
  const candidates: CatalogIntakeCandidateOutput[] = [];
  for (const stored of session.candidates) {
    const result = await discoveryPort.refetch({
      providerNamespace: stored.providerNamespace,
      placeId: stored.placeId,
    });
    if (!result.ok) {
      return addFailure(
        'dependency_failure',
        'Place discovery is temporarily unavailable.',
        true,
      );
    }
    const candidate = validateDiscoveryCandidate(result.value);
    if (
      !candidate ||
      candidate.durableIdentity.providerNamespace !==
        stored.providerNamespace ||
      candidate.durableIdentity.placeId !== stored.placeId
    ) {
      return addFailure(
        'dependency_failure',
        'Place discovery returned an invalid response.',
        false,
      );
    }
    candidates.push({
      ordinal: stored.ordinal,
      transientName: candidate.transientPresentation.name,
      transientAddress: candidate.transientPresentation.address,
      attribution: candidate.transientPresentation.attribution,
    });
  }
  return success({
    status:
      candidates.length === 0 ? 'clarification_required' : 'candidates_ready',
    sessionId: session.sessionId,
    sessionVersion: 1,
    candidates,
    hasMore: session.hasMore,
    expiresAt: session.discoverExpiresAt,
  });
}

function replaySelect(
  session: CatalogIntakeCandidatesSession | CatalogIntakePreviewSession,
): AddResult<CatalogIntakeSelectOutput> {
  if (session.state === 'preview_ready') {
    return success({
      status: 'preview_ready',
      sessionId: session.sessionId,
      sessionVersion: session.sessionVersion,
      preview: session.preview,
      expiresAt: session.expiresAt,
    });
  }
  return success({
    status: 'clarification_required',
    sessionId: session.sessionId,
    sessionVersion: session.sessionVersion,
    clarification: session.lastTransition?.clarification ?? {
      code: 'ambiguous_location',
      prompt: 'Add an area or address to identify the right place.',
      fields: ['area', 'address'],
    },
    expiresAt: session.expiresAt,
  });
}

function replayOrConflictSelect(
  current: CatalogIntakeStoredSession | undefined,
  input: CatalogIntakeSelectInput,
  inputJson: string,
): AddResult<CatalogIntakeSelectOutput> {
  if (
    current &&
    (current.state === 'candidates_ready' ||
      current.state === 'preview_ready') &&
    current.lastTransition?.operation === 'select' &&
    current.lastTransition.fromVersion === input.expectedSessionVersion &&
    current.lastTransition.inputJson === inputJson
  ) {
    return replaySelect(current);
  }
  return addFailure('conflict', 'Catalog intake session has changed.', false);
}

function canonicalSelectInput(input: CatalogIntakeSelectInput): string {
  return JSON.stringify(input);
}

async function expireIfNeeded(
  session: CatalogIntakeCandidatesSession | CatalogIntakePreviewSession,
  scope: CatalogIntakeScope,
  options: {
    readonly statePort: CatalogIntakeStatePort;
    readonly clock: { now(): Date };
  },
): Promise<
  | {
      readonly kind: 'active';
      readonly session:
        | CatalogIntakeCandidatesSession
        | CatalogIntakePreviewSession;
    }
  | { readonly kind: 'expired'; readonly session: CatalogIntakeExpiredSession }
  | {
      readonly kind: 'cancelled';
      readonly session: CatalogIntakeCancelledSession;
    }
  | { readonly kind: 'conflict' }
> {
  const now = options.clock.now();
  if (now.getTime() < Date.parse(session.expiresAt)) {
    return { kind: 'active', session };
  }
  const transitioned = await options.statePort.compareAndSwap({
    scope,
    sessionId: session.sessionId,
    expectedVersion: session.sessionVersion,
    next: expiredSession(session, now),
  });
  if (transitioned.kind === 'applied') {
    return {
      kind: 'expired',
      session: transitioned.session as CatalogIntakeExpiredSession,
    };
  }
  const current = transitioned.current;
  if (!current) return { kind: 'conflict' };
  if (current.state === 'expired') return { kind: 'expired', session: current };
  if (current.state === 'cancelled') {
    return { kind: 'cancelled', session: current };
  }
  if (current.state === 'committed') return { kind: 'conflict' };
  if (now.getTime() < Date.parse(current.expiresAt)) {
    return { kind: 'active', session: current };
  }
  return { kind: 'conflict' };
}

async function rejectedActiveCasExpired(
  current: CatalogIntakeStoredSession | undefined,
  scope: CatalogIntakeScope,
  options: {
    readonly statePort: CatalogIntakeStatePort;
    readonly clock: { now(): Date };
  },
): Promise<boolean> {
  if (current?.state === 'expired') return true;
  if (
    current?.state !== 'candidates_ready' &&
    current?.state !== 'preview_ready'
  ) {
    return false;
  }
  if (options.clock.now().getTime() < Date.parse(current.expiresAt)) {
    return false;
  }
  const expiration = await expireIfNeeded(current, scope, options);
  return expiration.kind === 'expired';
}

function expiredSession(
  session: CatalogIntakeCandidatesSession | CatalogIntakePreviewSession,
  now: Date,
): CatalogIntakeExpiredSession {
  return {
    state: 'expired',
    sessionId: session.sessionId,
    sessionVersion: session.sessionVersion + 1,
    ownerId: session.ownerId,
    channel: session.channel,
    conversationId: session.conversationId,
    expiredFromVersion: session.sessionVersion,
    requestToken: session.requestToken,
    normalizedOwnerQuery: session.normalizedOwnerQuery,
    expiredAt: now.toISOString(),
    terminalAt: now.toISOString(),
    retainUntil: receiptRetention(now),
  };
}

function sameScope(
  left: CatalogIntakeScope,
  right: CatalogIntakeScope,
): boolean {
  return (
    left.ownerId === right.ownerId &&
    left.channel === right.channel &&
    left.conversationId === right.conversationId
  );
}

function acceptedExpiry(now: Date): string {
  return new Date(now.getTime() + 30 * 60 * 1000).toISOString();
}

function receiptRetention(now: Date): string {
  return new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
}

function validateDiscoveryCandidate(
  value: unknown,
): GooglePlaceDiscoveryCandidate | undefined {
  return validateDiscoveryResult({
    candidates: [value],
    hasMore: false,
  })?.candidates[0];
}

export function validateDurableGeocoderProposal(
  value: unknown,
): DurableGeocoderProposal | undefined {
  if (
    isRecordWithExactKeys(value, ['status']) &&
    (value.status === 'ambiguous' || value.status === 'no_match')
  ) {
    return { status: value.status };
  }
  if (
    !isRecordWithExactKeys(value, [
      'status',
      'normalizedAddress',
      'latitude',
      'longitude',
      'provider',
      'sourceUrl',
      'license',
      'checkedAt',
    ]) ||
    value.status !== 'resolved'
  ) {
    return undefined;
  }
  const normalizedAddress = normalizeBoundedText(
    value.normalizedAddress,
    1,
    500,
  );
  const coordinates = validateCoordinates({
    latitude: value.latitude,
    longitude: value.longitude,
  });
  const provider = normalizeBoundedText(value.provider, 1, 120);
  const license = normalizeBoundedText(value.license, 1, 200);
  const checkedAt = normalizeIsoTimestamp(value.checkedAt);
  if (
    !normalizedAddress ||
    !coordinates ||
    !provider ||
    !isCanonicalHttpsUrl(value.sourceUrl) ||
    !license ||
    !checkedAt
  ) {
    return undefined;
  }
  return {
    status: 'resolved',
    normalizedAddress,
    ...coordinates,
    provider,
    sourceUrl: value.sourceUrl,
    license,
    checkedAt,
  };
}

function addFailure(
  code: AddErrorCode,
  message: string,
  retryable = false,
): AddResult<never> {
  const internalKinds: Record<AddErrorCode, ApplicationErrorKind> = {
    invalid_input: 'invalid_input',
    unauthorized: 'invalid_input',
    forbidden: 'invalid_input',
    not_found: 'not_found',
    conflict: 'conflict',
    expired: 'conflict',
    dependency_failure: 'dependency_failure',
    rate_limited: 'dependency_failure',
    unexpected_failure: 'unexpected_failure',
  };
  const error = { code, message, retryable } as AddError;
  Object.defineProperty(error, 'kind', {
    value: internalKinds[code],
    enumerable: false,
    writable: false,
  });
  return { ok: false, error };
}

function validateDiscoveryResult(value: unknown):
  | {
      readonly candidates: readonly GooglePlaceDiscoveryCandidate[];
      readonly hasMore: boolean;
    }
  | undefined {
  if (
    !isRecordWithExactKeys(value, ['candidates', 'hasMore']) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 3 ||
    typeof value.hasMore !== 'boolean'
  ) {
    return undefined;
  }
  const ordinals = new Set<number>();
  const identities = new Set<string>();
  const candidates: GooglePlaceDiscoveryCandidate[] = [];
  for (const candidate of value.candidates) {
    if (
      !isRecordWithExactKeys(candidate, [
        'durableIdentity',
        'transientPresentation',
      ]) ||
      !isRecordWithExactKeys(candidate.durableIdentity, [
        'providerNamespace',
        'placeId',
        'ordinal',
      ]) ||
      !isRecordWithExactKeys(candidate.transientPresentation, [
        'name',
        'address',
        'attribution',
      ]) ||
      !isRecordWithExactKeys(candidate.transientPresentation.attribution, [
        'label',
        'url',
      ])
    ) {
      return undefined;
    }
    const providerNamespace = normalizeBoundedText(
      candidate.durableIdentity.providerNamespace,
      1,
      100,
    );
    const placeId = normalizeBoundedText(
      candidate.durableIdentity.placeId,
      1,
      500,
    );
    const ordinal = candidate.durableIdentity.ordinal;
    const name = normalizeBoundedText(
      candidate.transientPresentation.name,
      1,
      500,
    );
    const address = normalizeBoundedText(
      candidate.transientPresentation.address,
      1,
      500,
    );
    const label = normalizeBoundedText(
      candidate.transientPresentation.attribution.label,
      1,
      120,
    );
    const url = candidate.transientPresentation.attribution.url;
    if (
      !providerNamespace ||
      !placeId ||
      !isPositiveInteger(ordinal) ||
      ordinals.has(ordinal) ||
      identities.has(`${providerNamespace}\u0000${placeId}`) ||
      !name ||
      !address ||
      !label ||
      !isCanonicalHttpsUrl(url)
    ) {
      return undefined;
    }
    ordinals.add(ordinal);
    identities.add(`${providerNamespace}\u0000${placeId}`);
    candidates.push({
      durableIdentity: { providerNamespace, placeId, ordinal },
      transientPresentation: {
        name,
        address,
        attribution: { label, url },
      },
    });
  }
  return { candidates, hasMore: value.hasMore };
}

function validateDiscoverInput(
  input: unknown,
): AddResult<CatalogIntakeDiscoverInput> {
  if (!isRecordWithExactKeys(input, ['query', 'requestToken'])) {
    return addFailure(
      'invalid_input',
      'A query and request token are required.',
    );
  }
  const query = normalizeBoundedText(input.query, 1, 500);
  const requestToken = normalizeBoundedText(input.requestToken, 1, 200);
  if (!query || !requestToken) {
    return addFailure(
      'invalid_input',
      'A query and request token are required.',
    );
  }
  return success({ query, requestToken });
}

function validateSelectInput(
  input: unknown,
): AddResult<CatalogIntakeSelectInput> {
  if (
    !isRecordWithAllowedKeys(
      input,
      [
        'sessionId',
        'expectedSessionVersion',
        'ordinal',
        'ownerFields',
        'tabelog',
        'reservation',
        'requestResearch',
      ],
      ['sessionId', 'expectedSessionVersion', 'ordinal', 'requestResearch'],
    )
  ) {
    return addFailure('invalid_input', 'A valid intake selection is required.');
  }
  const sessionId = normalizeBoundedText(input.sessionId, 1, 200);
  if (
    !sessionId ||
    !isPositiveInteger(input.expectedSessionVersion) ||
    !isPositiveInteger(input.ordinal) ||
    typeof input.requestResearch !== 'boolean'
  ) {
    return addFailure('invalid_input', 'A valid intake selection is required.');
  }
  const ownerFields = validateOwnerFields(input.ownerFields);
  if (input.ownerFields !== undefined && !ownerFields) {
    return addFailure('invalid_input', 'Owner fields are invalid.');
  }
  const tabelog = validateOwnerTabelog(input.tabelog);
  if (input.tabelog !== undefined && !tabelog) {
    return addFailure('invalid_input', 'The Tabelog assertion is invalid.');
  }
  const reservation = validateOwnerReservation(input.reservation);
  if (input.reservation !== undefined && !reservation) {
    return addFailure('invalid_input', 'The reservation assertion is invalid.');
  }
  return success({
    sessionId,
    expectedSessionVersion: input.expectedSessionVersion,
    ordinal: input.ordinal,
    ...(ownerFields ? { ownerFields } : {}),
    ...(tabelog ? { tabelog } : {}),
    ...(reservation ? { reservation } : {}),
    requestResearch: input.requestResearch,
  });
}

function validateConfirmInput(
  input: unknown,
): AddResult<CatalogIntakeConfirmInput> {
  if (!isRecordWithExactKeys(input, ['sessionId', 'expectedPreviewVersion'])) {
    return addFailure(
      'invalid_input',
      'A valid intake confirmation is required.',
    );
  }
  const sessionId = normalizeBoundedText(input.sessionId, 1, 200);
  if (!sessionId || !isPositiveInteger(input.expectedPreviewVersion)) {
    return addFailure(
      'invalid_input',
      'A valid intake confirmation is required.',
    );
  }
  return success({
    sessionId,
    expectedPreviewVersion: input.expectedPreviewVersion,
  });
}

function validateCancelInput(
  input: unknown,
): AddResult<CatalogIntakeCancelInput> {
  if (!isRecordWithExactKeys(input, ['sessionId', 'expectedSessionVersion'])) {
    return addFailure(
      'invalid_input',
      'A valid intake cancellation is required.',
    );
  }
  const sessionId = normalizeBoundedText(input.sessionId, 1, 200);
  if (!sessionId || !isPositiveInteger(input.expectedSessionVersion)) {
    return addFailure(
      'invalid_input',
      'A valid intake cancellation is required.',
    );
  }
  return success({
    sessionId,
    expectedSessionVersion: input.expectedSessionVersion,
  });
}

function validateOwnerFields(
  value: unknown,
): CatalogIntakeOwnerFields | undefined {
  if (value === undefined) return {};
  if (
    !isRecordWithAllowedKeys(
      value,
      ['title', 'address', 'area', 'coordinates'],
      [],
    )
  ) {
    return undefined;
  }
  const title =
    value.title === undefined
      ? undefined
      : normalizeBoundedText(value.title, 1, 200);
  const address =
    value.address === undefined
      ? undefined
      : normalizeBoundedText(value.address, 1, 500);
  const area =
    value.area === undefined
      ? undefined
      : normalizeBoundedText(value.area, 0, 120);
  const coordinates =
    value.coordinates === undefined
      ? undefined
      : validateCoordinates(value.coordinates);
  if (
    (value.title !== undefined && !title) ||
    (value.address !== undefined && !address) ||
    (value.area !== undefined && area === undefined) ||
    (value.coordinates !== undefined && !coordinates)
  ) {
    return undefined;
  }
  return {
    ...(title ? { title } : {}),
    ...(address ? { address } : {}),
    ...(area !== undefined ? { area } : {}),
    ...(coordinates ? { coordinates } : {}),
  };
}

export function validateOwnerTabelog(
  value: unknown,
): OwnerTabelogAssertion | 'unknown' | undefined {
  if (value === undefined || value === 'unknown') return value;
  if (
    !isRecordWithAllowedKeys(
      value,
      ['score', 'reviewCount', 'url'],
      ['score', 'url'],
    )
  ) {
    return undefined;
  }
  const { score, reviewCount, url } = value;
  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 5 ||
    !hasAtMostTwoDecimalPlaces(score) ||
    (reviewCount !== undefined &&
      (typeof reviewCount !== 'number' ||
        !Number.isInteger(reviewCount) ||
        reviewCount < 0 ||
        reviewCount > 2_147_483_647)) ||
    !isCanonicalTabelogUrl(url)
  ) {
    return undefined;
  }
  return {
    score,
    ...(typeof reviewCount === 'number' ? { reviewCount } : {}),
    url,
  };
}

export function validateOwnerReservation(
  value: unknown,
): OwnerReservationAssertion | 'unknown' | undefined {
  if (value === undefined || value === 'unknown') return value;
  if (
    !isRecordWithAllowedKeys(
      value,
      [
        'mode',
        'label',
        'advanceDays',
        'bookingWindowLabel',
        'releaseNote',
        'channel',
        'url',
      ],
      ['mode', 'label', 'url'],
    )
  ) {
    return undefined;
  }
  const {
    mode,
    label,
    advanceDays,
    bookingWindowLabel,
    releaseNote,
    channel,
    url,
  } = value;
  if (
    (mode !== 'reservable' && mode !== 'reservation_required') ||
    typeof label !== 'string' ||
    !isOptionalBoundedText(label, 1, 500) ||
    (advanceDays !== undefined &&
      (typeof advanceDays !== 'number' ||
        !Number.isInteger(advanceDays) ||
        advanceDays < 0 ||
        advanceDays > 3650)) ||
    !isOptionalBoundedText(bookingWindowLabel, 0, 500) ||
    !isOptionalBoundedText(releaseNote, 0, 500) ||
    !isOptionalBoundedText(channel, 0, 120) ||
    !isCanonicalHttpsUrl(url)
  ) {
    return undefined;
  }
  return {
    mode,
    label: label.normalize('NFC').trim(),
    ...(typeof advanceDays === 'number' ? { advanceDays } : {}),
    ...(typeof bookingWindowLabel === 'string'
      ? { bookingWindowLabel: bookingWindowLabel.normalize('NFC').trim() }
      : {}),
    ...(typeof releaseNote === 'string'
      ? { releaseNote: releaseNote.normalize('NFC').trim() }
      : {}),
    ...(typeof channel === 'string'
      ? { channel: channel.normalize('NFC').trim() }
      : {}),
    url,
  };
}

export function validateWebResearchOutput(
  value: unknown,
  preview: Pick<CatalogIntakePreview, 'tabelog' | 'reservation'>,
):
  | {
      readonly tabelog: CatalogIntakeTabelogSnapshot;
      readonly reservation: CatalogIntakeReservationSnapshot;
    }
  | undefined {
  if (!isRecordWithExactKeys(value, ['tabelog', 'reservation'])) {
    return undefined;
  }
  const tabelog = validateResearchTabelog(value.tabelog, preview.tabelog);
  const reservation = validateResearchReservation(
    value.reservation,
    preview.reservation,
  );
  return tabelog && reservation ? { tabelog, reservation } : undefined;
}

function validateResearchTabelog(
  value: unknown,
  prior: CatalogIntakeTabelogSnapshot,
): CatalogIntakeTabelogSnapshot | undefined {
  if (isRecordWithExactKeys(value, ['status']) && value.status === 'unknown') {
    return { status: 'unknown' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const provenance = record.provenance;
  const timestampKey =
    provenance === 'agent_observed'
      ? 'observedAt'
      : provenance === 'owner_asserted'
        ? 'assertedAt'
        : undefined;
  const allowed = timestampKey
    ? [
        'status',
        'score',
        'reviewCount',
        'url',
        'provenance',
        timestampKey,
        'freshness',
      ]
    : [];
  if (
    !timestampKey ||
    !isRecordWithAllowedKeys(record, allowed, [
      'status',
      'score',
      'url',
      'provenance',
      timestampKey,
      'freshness',
    ]) ||
    record.status !== 'known' ||
    (record.freshness !== 'fresh' && record.freshness !== 'stale') ||
    !normalizeIsoTimestamp(record[timestampKey])
  ) {
    return undefined;
  }
  const assertion = validateOwnerTabelog({
    score: record.score,
    ...(record.reviewCount === undefined
      ? {}
      : { reviewCount: record.reviewCount }),
    url: record.url,
  });
  if (!assertion || assertion === 'unknown') return undefined;
  const normalized = {
    status: 'known' as const,
    ...assertion,
    provenance,
    [timestampKey]: record[timestampKey],
    freshness: record.freshness,
  } as CatalogIntakeTabelogSnapshot;
  return provenance === 'owner_asserted' &&
    canonicalJson(normalized) !== canonicalJson(prior)
    ? undefined
    : normalized;
}

function validateResearchReservation(
  value: unknown,
  prior: CatalogIntakeReservationSnapshot,
): CatalogIntakeReservationSnapshot | undefined {
  if (isRecordWithExactKeys(value, ['status']) && value.status === 'unknown') {
    return { status: 'unknown' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const provenance = record.provenance;
  const timestampKey =
    provenance === 'agent_observed'
      ? 'observedAt'
      : provenance === 'owner_asserted'
        ? 'assertedAt'
        : undefined;
  const assertionKeys = [
    'mode',
    'label',
    'advanceDays',
    'bookingWindowLabel',
    'releaseNote',
    'channel',
    'url',
  ] as const;
  if (
    !timestampKey ||
    !isRecordWithAllowedKeys(
      record,
      ['status', 'provenance', timestampKey, 'freshness', ...assertionKeys],
      [
        'status',
        'mode',
        'label',
        'url',
        'provenance',
        timestampKey,
        'freshness',
      ],
    ) ||
    record.status !== 'known' ||
    (record.freshness !== 'fresh' && record.freshness !== 'stale') ||
    !normalizeIsoTimestamp(record[timestampKey])
  ) {
    return undefined;
  }
  const assertion = validateOwnerReservation(
    Object.fromEntries(
      assertionKeys.flatMap((key) =>
        record[key] === undefined ? [] : [[key, record[key]]],
      ),
    ),
  );
  if (!assertion || assertion === 'unknown') return undefined;
  const normalized = {
    status: 'known' as const,
    ...assertion,
    provenance,
    [timestampKey]: record[timestampKey],
    freshness: record.freshness,
  } as CatalogIntakeReservationSnapshot;
  return provenance === 'owner_asserted' &&
    canonicalJson(normalized) !== canonicalJson(prior)
    ? undefined
    : normalized;
}

function validateCoordinates(value: unknown) {
  if (
    !isRecordWithExactKeys(value, ['latitude', 'longitude']) ||
    typeof value.latitude !== 'number' ||
    typeof value.longitude !== 'number' ||
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    value.longitude < -180 ||
    value.longitude > 180
  ) {
    return undefined;
  }
  return { latitude: value.latitude, longitude: value.longitude };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) &&
    timestamp.toISOString() === value
    ? value
    : undefined;
}

function isOptionalBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  return (
    value === undefined ||
    normalizeBoundedText(value, minimum, maximum) !== undefined
  );
}

function isCanonicalHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash &&
      parsed.toString() === value
    );
  } catch {
    return false;
  }
}

function isCanonicalTabelogUrl(value: unknown): value is string {
  if (!isCanonicalHttpsUrl(value)) return false;
  const parsed = new URL(value);
  return (
    (parsed.hostname === 'tabelog.com' ||
      parsed.hostname === 'www.tabelog.com') &&
    !parsed.search &&
    /^\/[a-z][a-z0-9-]{0,63}\/A\d{1,12}\/A\d{1,12}\/\d{1,20}\/$/u.test(
      parsed.pathname,
    )
  );
}

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const scaled = value * 100;
  return (
    Math.abs(scaled - Math.round(scaled)) <=
    Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4
  );
}

function normalizeBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFC').trim();
  return normalized.length >= minimum &&
    normalized.length <= maximum &&
    !/\p{Cc}/u.test(normalized)
    ? normalized
    : undefined;
}

function isRecordWithExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRecordWithAllowedKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowed.includes(key)) &&
    required.every((key) => keys.includes(key))
  );
}

const confirmProviderUnavailableWarning: CatalogIntakeWarning = {
  code: 'provider_unavailable',
  message:
    'One or more enabled evidence providers could not be refreshed; retained evidence is stale or unknown.',
};

const staleEvidenceWarning: CatalogIntakeWarning = {
  code: 'stale_evidence',
  message:
    'Previously observed evidence could not be refreshed and must be reviewed.',
};

function withConfirmProviderUnavailableWarning(
  warnings: readonly CatalogIntakeWarning[],
  includeStaleEvidence: boolean,
): readonly CatalogIntakeWarning[] {
  return canonicalizeCatalogIntakeWarnings(
    warnings
      .filter(
        ({ code }) =>
          code !== 'stale_evidence' && code !== 'provider_unavailable',
      )
      .concat(
        includeStaleEvidence ? [staleEvidenceWarning] : [],
        confirmProviderUnavailableWarning,
      ),
  );
}

function hasStaleAgentEvidence(
  tabelog: CatalogIntakeTabelogSnapshot,
  reservation: CatalogIntakeReservationSnapshot,
): boolean {
  return [tabelog, reservation].some(
    (snapshot) =>
      snapshot.status === 'known' &&
      snapshot.provenance === 'agent_observed' &&
      snapshot.freshness === 'stale',
  );
}

function withoutRefreshFailureWarnings(
  warnings: readonly CatalogIntakeWarning[],
): readonly CatalogIntakeWarning[] {
  return canonicalizeCatalogIntakeWarnings(
    warnings.filter(
      ({ code }) =>
        code !== 'stale_evidence' && code !== 'provider_unavailable',
    ),
  );
}

function markAgentTabelogStale(
  snapshot: CatalogIntakeTabelogSnapshot,
): CatalogIntakeTabelogSnapshot {
  return snapshot.status === 'known' &&
    snapshot.provenance === 'agent_observed' &&
    snapshot.freshness !== 'stale'
    ? { ...snapshot, freshness: 'stale' }
    : snapshot;
}

function markAgentReservationStale(
  snapshot: CatalogIntakeReservationSnapshot,
): CatalogIntakeReservationSnapshot {
  return snapshot.status === 'known' &&
    snapshot.provenance === 'agent_observed' &&
    snapshot.freshness !== 'stale'
    ? { ...snapshot, freshness: 'stale' }
    : snapshot;
}

function stabilizeResearchEvidence(
  refreshed: {
    readonly tabelog: CatalogIntakeTabelogSnapshot;
    readonly reservation: CatalogIntakeReservationSnapshot;
  },
  prior: CatalogIntakePreview,
) {
  return {
    tabelog: stabilizeResearchSnapshot(
      refreshed.tabelog,
      prior.tabelog,
      markAgentTabelogStale,
    ),
    reservation: stabilizeResearchSnapshot(
      refreshed.reservation,
      prior.reservation,
      markAgentReservationStale,
    ),
  };
}

function stabilizeResearchSnapshot<Snapshot>(
  refreshed: Snapshot & { readonly status: 'known' | 'unknown' },
  prior: Snapshot & { readonly status: 'known' | 'unknown' },
  markStale: (snapshot: Snapshot) => Snapshot,
): Snapshot {
  if (refreshed.status === 'unknown' && prior.status === 'known') {
    return markStale(prior);
  }
  return sameAgentObservedFacts(refreshed, prior) ? prior : refreshed;
}

function sameAgentObservedFacts(left: unknown, right: unknown): boolean {
  if (
    !isRecord(left) ||
    !isRecord(right) ||
    left.status !== 'known' ||
    right.status !== 'known' ||
    left.provenance !== 'agent_observed' ||
    right.provenance !== 'agent_observed'
  ) {
    return false;
  }
  const { observedAt: _leftObservedAt, ...leftFacts } = left;
  const { observedAt: _rightObservedAt, ...rightFacts } = right;
  return canonicalJson(leftFacts) === canonicalJson(rightFacts);
}

async function digestCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function deriveCatalogIntakeResearchInputDigest(input: {
  readonly phase: 'initial';
  readonly normalizedOwnerQuery: string;
}): Promise<string>;
export function deriveCatalogIntakeResearchInputDigest(input: {
  readonly phase: 'confirm';
  readonly canonicalUrls: readonly string[];
}): Promise<string | undefined>;
export async function deriveCatalogIntakeResearchInputDigest(
  input:
    | {
        readonly phase: 'initial';
        readonly normalizedOwnerQuery: string;
      }
    | { readonly phase: 'confirm'; readonly canonicalUrls: readonly string[] },
): Promise<string | undefined> {
  if (input.phase === 'initial') {
    return digestCanonical({
      phase: 'initial',
      query: input.normalizedOwnerQuery,
    });
  }
  const canonicalUrls = [...new Set(input.canonicalUrls)].sort(codeUnitOrder);
  return canonicalUrls.length === 0
    ? undefined
    : digestCanonical({ phase: 'confirm', canonicalUrls });
}

async function researchPhaseDigestsForPreview(
  session: CatalogIntakeCandidatesSession | CatalogIntakePreviewSession,
  preview: CatalogIntakePreview,
): Promise<CatalogIntakeActiveSessionBase['researchPhaseDigests']> {
  const canonicalUrls = catalogIntakeCanonicalResearchUrls(preview);
  const confirm = await deriveCatalogIntakeResearchInputDigest({
    phase: 'confirm',
    canonicalUrls,
  });
  return {
    initial: session.researchPhaseDigests.initial,
    ...(confirm ? { confirm } : {}),
  };
}

function catalogIntakeCanonicalResearchUrls(
  preview: Pick<CatalogIntakePreview, 'tabelog' | 'reservation'>,
): readonly string[] {
  return [
    ...new Set([
      ...(preview.tabelog.status === 'known' ? [preview.tabelog.url] : []),
      ...(preview.reservation.status === 'known'
        ? [preview.reservation.url]
        : []),
    ]),
  ].sort(codeUnitOrder);
}

function deriveAddConfirmMutationKey(
  scope: CatalogIntakeScope,
  preview: CatalogIntakePreview,
): Promise<string> {
  return deriveAddConfirmMutationKeyFromParts(
    scope,
    preview.sessionId,
    preview.previewVersion,
    preview.evidenceDigest,
  );
}

function deriveAddConfirmMutationKeyFromParts(
  scope: CatalogIntakeScope,
  sessionId: string,
  previewVersion: number,
  evidenceDigest: string,
): Promise<string> {
  return digestCanonical([
    'add-confirm:v1',
    scope.ownerId,
    'catalog.intake.confirm',
    sessionId,
    previewVersion,
    evidenceDigest,
  ]);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => codeUnitOrder(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
