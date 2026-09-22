import {
  defineOperationGroup,
  type OperationDefinition,
} from '../atlas-application.ts';
import {
  success,
  type ApplicationError,
  type ApplicationErrorKind,
  type Result,
} from '../result.ts';

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
  readonly code:
    | 'stale_evidence'
    | 'provider_unavailable'
    | 'source_conflict'
    | 'needs_review';
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

interface CatalogIntakeStoredCandidate {
  readonly providerNamespace: string;
  readonly placeId: string;
  readonly ordinal: number;
  readonly createdAt: string;
}

interface CatalogIntakeCandidatesSession {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly state: 'candidates_ready';
  readonly ownerQuery: string;
  readonly requestToken: string;
  readonly candidates: readonly CatalogIntakeStoredCandidate[];
  readonly catalogRevision: string;
  readonly expiresAt: string;
}

interface CatalogIntakePreviewSession {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly state: 'preview_ready';
  readonly ownerQuery: string;
  readonly requestToken: string;
  readonly candidates: readonly CatalogIntakeStoredCandidate[];
  readonly catalogRevision: string;
  readonly expiresAt: string;
  readonly preview: CatalogIntakePreview;
}

interface CatalogIntakeCancelledSession {
  readonly sessionId: string;
  readonly state: 'cancelled';
  readonly cancelledFromVersion: number;
}

type CatalogIntakeStoredSession =
  | CatalogIntakeCandidatesSession
  | CatalogIntakePreviewSession
  | CatalogIntakeCancelledSession;

export interface CatalogIntakeStatePort {
  create(session: CatalogIntakeStoredSession): Promise<void>;
  get(sessionId: string): Promise<CatalogIntakeStoredSession | undefined>;
  replace(session: CatalogIntakeStoredSession): Promise<void>;
}

export interface CatalogIntakeModule {
  discover(
    input: CatalogIntakeDiscoverInput,
  ): Promise<AddResult<CatalogIntakeDiscoverOutput>>;
  select(
    input: CatalogIntakeSelectInput,
  ): Promise<AddResult<CatalogIntakeSelectOutput>>;
  confirm(
    input: CatalogIntakeConfirmInput,
  ): Promise<AddResult<CatalogIntakeConfirmOutput>>;
  cancel(
    input: CatalogIntakeCancelInput,
  ): Promise<AddResult<CatalogIntakeCancelOutput>>;
}

export function createCatalogIntakeModule(options: {
  readonly discoveryPort: GooglePlaceDiscoveryPort;
  readonly statePort: CatalogIntakeStatePort;
  readonly clock: { now(): Date };
  readonly idSource: { nextId(): string };
  readonly catalogRevision: { read(): Promise<string> };
}): CatalogIntakeModule {
  return {
    async discover(input) {
      try {
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
        const expiresAt = new Date(
          now.getTime() + 30 * 60 * 1000,
        ).toISOString();
        const catalogRevision = await options.catalogRevision.read();
        await options.statePort.create({
          sessionId,
          sessionVersion: 1,
          state: 'candidates_ready',
          ownerQuery: input.query,
          requestToken: input.requestToken,
          candidates: discovery.candidates.map(({ durableIdentity }) => ({
            ...durableIdentity,
            createdAt: now.toISOString(),
          })),
          catalogRevision,
          expiresAt,
        });

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
    async select(input) {
      try {
        const session = await options.statePort.get(input.sessionId);
        if (!session) {
          return addFailure(
            'not_found',
            'Catalog intake session was not found.',
            false,
          );
        }
        if (
          session.state !== 'candidates_ready' ||
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
        const ownerFields = input.ownerFields ?? {};
        if (!ownerFields.title && !ownerFields.address) {
          return success({
            status: 'clarification_required',
            sessionId: session.sessionId,
            sessionVersion: session.sessionVersion,
            clarification: {
              code: 'missing_area_or_address',
              prompt: 'Add a restaurant name, area, or address to continue.',
              fields: ['title', 'area', 'address'],
            },
            expiresAt: session.expiresAt,
          });
        }

        const assertedAt = options.clock.now().toISOString();
        const locationEvidence =
          ownerFields.coordinates && ownerFields.address
            ? {
                status: 'known' as const,
                provenance: 'owner_asserted' as const,
                address: ownerFields.address,
                ...ownerFields.coordinates,
                assertedAt,
              }
            : { status: 'unknown' as const };
        const tabelog =
          input.tabelog && input.tabelog !== 'unknown'
            ? {
                status: 'known' as const,
                ...input.tabelog,
                provenance: 'owner_asserted' as const,
                assertedAt,
                freshness: 'fresh' as const,
              }
            : { status: 'unknown' as const };
        const reservation =
          input.reservation && input.reservation !== 'unknown'
            ? {
                status: 'known' as const,
                ...input.reservation,
                provenance: 'owner_asserted' as const,
                assertedAt,
                freshness: 'fresh' as const,
              }
            : { status: 'unknown' as const };
        const previewWithoutDigest = {
          sessionId: session.sessionId,
          previewVersion: 1,
          state: 'preview_ready' as const,
          candidateIdentity: {
            providerNamespace: candidate.providerNamespace,
            placeId: candidate.placeId,
          },
          ownerFields,
          locationEvidence,
          tabelog,
          reservation,
          suspectedDuplicates: [] as const,
          unknownFields: [
            ...(!ownerFields.address ? (['address'] as const) : []),
            ...(locationEvidence.status === 'unknown'
              ? (['coordinates'] as const)
              : []),
            ...(tabelog.status === 'unknown' ? (['tabelog'] as const) : []),
            ...(reservation.status === 'unknown'
              ? (['reservation'] as const)
              : []),
          ],
          warnings: [
            {
              code: 'needs_review' as const,
              message: 'Provider enrichment is not enabled for this preview.',
            },
          ],
          catalogRevision: session.catalogRevision,
          expiresAt: session.expiresAt,
        };
        const preview: CatalogIntakePreview = {
          ...previewWithoutDigest,
          evidenceDigest: await digestCanonical(previewWithoutDigest),
        };
        await options.statePort.replace({
          ...session,
          state: 'preview_ready',
          sessionVersion: 2,
          preview,
        });
        return success({
          status: 'preview_ready',
          sessionId: session.sessionId,
          sessionVersion: 2,
          preview,
          expiresAt: session.expiresAt,
        });
      } catch {
        return addFailure(
          'dependency_failure',
          'Catalog intake state is temporarily unavailable.',
          true,
        );
      }
    },
    async confirm(input) {
      try {
        const session = await options.statePort.get(input.sessionId);
        if (!session) {
          return addFailure(
            'not_found',
            'Catalog intake session was not found.',
            false,
          );
        }
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
    async cancel(input) {
      try {
        const session = await options.statePort.get(input.sessionId);
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
        if (session.sessionVersion !== input.expectedSessionVersion) {
          return addFailure(
            'conflict',
            'Catalog intake session has changed.',
            false,
          );
        }
        await options.statePort.replace({
          state: 'cancelled',
          sessionId: session.sessionId,
          cancelledFromVersion: input.expectedSessionVersion,
        });
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
    handle: (input) => module.discover(input),
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
    handle: (input) => module.select(input),
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
    handle: (input) => module.confirm(input),
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
    handle: (input) => module.cancel(input),
  };

  return defineOperationGroup({
    'catalog.intake.discover': discover,
    'catalog.intake.select': select,
    'catalog.intake.confirm': confirm,
    'catalog.intake.cancel': cancel,
  });
}

export function createInMemoryCatalogIntakeStatePort(): CatalogIntakeStatePort {
  const sessions = new Map<string, CatalogIntakeStoredSession>();
  return {
    async create(session) {
      sessions.set(session.sessionId, structuredClone(session));
    },
    async get(sessionId) {
      const session = sessions.get(sessionId);
      return session ? structuredClone(session) : undefined;
    },
    async replace(session) {
      sessions.set(session.sessionId, structuredClone(session));
    },
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
      !name ||
      !address ||
      !label ||
      !isCanonicalHttpsUrl(url)
    ) {
      return undefined;
    }
    ordinals.add(ordinal);
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

function validateOwnerTabelog(
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

function validateOwnerReservation(
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

async function digestCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}
