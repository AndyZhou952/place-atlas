// The Add workflow: a per-conversation session moves discover → select → confirm (or cancel).
// Every step writes with compare-and-swap on the session version, sessions expire 30 minutes after
// the last accepted step, and confirm re-checks the place before publishing exactly once.
import { success, type Result } from '../../../shared/result.ts';
import { canonicalizeCatalogIntakeWarnings } from '../../../shared/catalog-intake-warnings.ts';
import { findSavedPlaceDuplicates, type SavedPlace } from './saved-place-duplicates.ts';
import type {
  AddResult,
  CatalogIntakeAddressProposal,
  CatalogIntakeCancelInput,
  CatalogIntakeCancelOutput,
  CatalogIntakeClarification,
  CatalogIntakeConfirmInput,
  CatalogIntakeConfirmOutput,
  CatalogIntakeDiscoverInput,
  CatalogIntakeDiscoverOutput,
  CatalogIntakeEnrichedProfile,
  CatalogIntakeLocationEvidence,
  CatalogIntakeOwnerFields,
  CatalogIntakePreview,
  CatalogIntakeReservationSnapshot,
  CatalogIntakeScope,
  CatalogIntakeSelectInput,
  CatalogIntakeSelectOutput,
  CatalogIntakeTabelogSnapshot,
  CatalogIntakeTitleProposal,
  CatalogIntakeAttribution,
} from '../../../shared/catalog-intake.ts';
import {
  addFailure,
  canonicalJson,
  catalogIntakeCanonicalResearchUrls,
  deriveAddConfirmMutationKey,
  deriveAddConfirmMutationKeyFromParts,
  digestCanonical,
  hasStaleAgentEvidence,
  locationOwnerFields,
  markAgentReservationStale,
  markAgentTabelogStale,
  mergeEnrichedProfile,
  normalizeBoundedText,
  sameCandidateIdentity,
  stabilizeResearchEvidence,
  validateCancelInput,
  validateConfirmInput,
  validateDiscoverInput,
  validateDiscoveryCandidate,
  validateDiscoveryResult,
  validateDurableGeocoderProposal,
  validateSelectInput,
  validateWebResearchOutput,
  withConfirmProviderUnavailableWarning,
  withoutRefreshFailureWarnings,
} from './validate.ts';
export type * from '../../../shared/catalog-intake.ts';
export {
  validateDurableGeocoderProposal,
  validateEnrichedProfile,
  validateOwnerReservation,
  validateOwnerTabelog,
  validateWebResearchOutput,
} from './validate.ts';

// --- Ports -------------------------------------------------------------------------------------

/** A place candidate: the durable identity is stored, the presentation is request scoped. */
export interface GooglePlaceDiscoveryCandidate {
  readonly durableIdentity: {
    readonly providerNamespace: string;
    readonly placeId: string;
    readonly ordinal: number;
  };
  readonly transientPresentation: {
    readonly name: string;
    readonly address: string;
    readonly attribution: CatalogIntakeAttribution;
  };
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
    readonly ownerQuery: string;
    readonly ownerDraft: CatalogIntakeOwnerFields;
    readonly selectedSubject: CatalogIntakeSelectedSubject;
  }): Promise<Result<DurableGeocoderProposal>>;
}

/** The place the Owner picked, as research sees it. */
export interface CatalogIntakeSelectedSubject {
  readonly ownerQuery: string;
  readonly providerNamespace: string;
  readonly placeId: string;
  readonly transientName: string;
  readonly transientAddress: string;
}

export type WebResearchInput =
  | {
      readonly phase: 'initial';
      readonly selectedSubject: CatalogIntakeSelectedSubject;
    }
  | {
      readonly phase: 'confirm';
      readonly canonicalUrls: readonly string[];
      readonly preview: CatalogIntakePreview;
      readonly selectedSubject: CatalogIntakeSelectedSubject;
    };

export type WebResearchOutcome =
  | {
      readonly kind: 'observed';
      readonly sourceAccessIssue?: 'blocked' | 'unavailable';
      readonly value: {
        readonly tabelog: CatalogIntakeTabelogSnapshot;
        readonly reservation: CatalogIntakeReservationSnapshot;
        readonly profile?: CatalogIntakeEnrichedProfile;
      };
    }
  | { readonly kind: 'unavailable'; readonly reason?: 'timed_out' };

export interface WebResearchPort {
  research(input: WebResearchInput): Promise<WebResearchOutcome>;
}

export interface AtlasCatalogIntakePort {
  publish(
    preview: CatalogIntakePreview,
    mutationKey: string,
    expectedSessionVersion: number,
    catalogRevision: string,
  ): Promise<CatalogIntakeConfirmOutput>;
}

// --- Session state -----------------------------------------------------------------------------

export interface CatalogIntakeStoredCandidate {
  readonly providerNamespace: string;
  readonly placeId: string;
  readonly ordinal: number;
  readonly createdAt: string;
}

interface CatalogIntakeActiveSessionBase extends CatalogIntakeScope {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly ownerQuery: string;
  readonly normalizedOwnerQuery: string;
  readonly requestToken: string;
  readonly hasMore: boolean;
  readonly candidates: readonly CatalogIntakeStoredCandidate[];
  readonly catalogRevision: string;
  readonly createdAt: string;
  readonly lastAcceptedActivityAt: string;
  readonly expiresAt: string;
}

export interface CatalogIntakeCandidatesSession extends CatalogIntakeActiveSessionBase {
  readonly state: 'candidates_ready';
}

export interface CatalogIntakePreviewSession extends CatalogIntakeActiveSessionBase {
  readonly state: 'preview_ready';
  readonly preview: CatalogIntakePreview;
  readonly confirmMutationKey?: string;
  /** The preview version whose confirm-time research already ran, so a retry does not repeat it. */
  readonly confirmResearchedVersion?: number;
}

interface CatalogIntakeTerminalBase extends CatalogIntakeScope {
  readonly sessionId: string;
  readonly sessionVersion: number;
  readonly requestToken: string;
  readonly normalizedOwnerQuery: string;
  readonly terminalAt: string;
  readonly retainUntil: string;
}

export interface CatalogIntakeCancelledSession extends CatalogIntakeTerminalBase {
  readonly state: 'cancelled';
  readonly cancelledFromVersion: number;
}

export interface CatalogIntakeExpiredSession extends CatalogIntakeTerminalBase {
  readonly state: 'expired';
  readonly expiredFromVersion: number;
  readonly expiredAt: string;
}

export interface CatalogIntakeCommittedSession extends CatalogIntakeTerminalBase {
  readonly state: 'committed';
  readonly committedFromVersion: number;
  readonly mutationKey: string;
  readonly previewVersion: number;
  readonly evidenceDigest: string;
  readonly outcome: Extract<CatalogIntakeConfirmOutput, { readonly replayed: boolean }>;
}

type ActiveSession = CatalogIntakeCandidatesSession | CatalogIntakePreviewSession;

export type CatalogIntakeStoredSession =
  | ActiveSession
  | CatalogIntakeCommittedSession
  | CatalogIntakeCancelledSession
  | CatalogIntakeExpiredSession;

export interface CatalogIntakeStatePort {
  /** Stores a new session, cancelling the conversation's active one. */
  create(session: CatalogIntakeCandidatesSession): Promise<void>;
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
  cleanup(now: Date): Promise<{ readonly expired: number; readonly removed: number }>;
}

// --- The workflow ------------------------------------------------------------------------------

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

export interface CatalogIntakeOptions {
  readonly discoveryPort: GooglePlaceDiscoveryPort;
  readonly durableGeocoderPort?: DurableGeocoderPort;
  readonly webResearchPort?: WebResearchPort;
  readonly enrichmentPolicy?: 'disabled' | 'enrich_if_available';
  readonly atlasCatalogIntakePort?: AtlasCatalogIntakePort;
  readonly savedPlaceLookup?: { list(): Promise<readonly SavedPlace[]> };
  readonly statePort: CatalogIntakeStatePort;
  readonly clock: { now(): Date };
  readonly idSource: { nextId(): string };
  readonly catalogRevision: { read(): Promise<string> };
}

const expired = () => addFailure('expired', 'Catalog intake session has expired.');
const changed = (message = 'Catalog intake session has changed.') =>
  addFailure('conflict', message);
const previewChanged = () => changed('Catalog intake preview has changed.');
const noWrite = (reason: 'validation' | 'dependency') =>
  success({ status: 'failed_no_write' as const, reason });

export function createCatalogIntakeModule(options: CatalogIntakeOptions): CatalogIntakeModule {
  const { statePort, clock } = options;

  /** A CAS lost to a concurrent step, or to the clock: report which. */
  async function lostCas(
    current: CatalogIntakeStoredSession | undefined,
    scope: CatalogIntakeScope,
  ) {
    if (current?.state === 'expired') return true;
    return isActive(current) && (await expireIfNeeded(current, scope, options)) === 'expired';
  }

  /** The step's session, still active; terminal and expired sessions become errors. */
  async function activeSession(
    scope: CatalogIntakeScope,
    sessionId: string,
  ): Promise<
    | AddResult<ActiveSession>
    | { readonly ok: 'terminal'; readonly session: CatalogIntakeStoredSession }
  > {
    const session = await statePort.get(scope, sessionId);
    if (!session) return addFailure('not_found', 'Catalog intake session was not found.');
    if (!isActive(session)) return { ok: 'terminal', session };
    const expiry = await expireIfNeeded(session, scope, options);
    if (expiry === 'active') return success(session);
    if (expiry === 'expired') return expired();
    return typeof expiry === 'object' ? { ok: 'terminal', session: expiry } : changed();
  }

  /** Writes a refreshed preview and reports it to the Owner as a conflict to review. */
  async function republish(
    session: CatalogIntakePreviewSession,
    scope: CatalogIntakeScope,
    newPreview: CatalogIntakePreview,
    confirmResearched: boolean,
  ): Promise<AddResult<CatalogIntakeConfirmOutput>> {
    const next: CatalogIntakePreviewSession = {
      ...session,
      sessionVersion: session.sessionVersion + 1,
      lastAcceptedActivityAt: clock.now().toISOString(),
      expiresAt: newPreview.expiresAt,
      preview: newPreview,
      ...(confirmResearched ? { confirmResearchedVersion: newPreview.previewVersion } : {}),
    };
    const written = await cas(session, scope, next);
    if (written.kind === 'applied') return success({ status: 'conflict', newPreview });
    return (await lostCas(written.current, scope)) ? expired() : previewChanged();
  }

  const cas = (
    session: ActiveSession,
    scope: CatalogIntakeScope,
    next: CatalogIntakeStoredSession,
  ) =>
    statePort.compareAndSwap({
      scope,
      sessionId: session.sessionId,
      expectedVersion: session.sessionVersion,
      next,
    });

  async function discover(
    input: CatalogIntakeDiscoverInput,
    scope: CatalogIntakeScope,
  ): Promise<AddResult<CatalogIntakeDiscoverOutput>> {
    const discovered = await options.discoveryPort.discover({ query: input.query });
    if (!discovered.ok)
      return addFailure('dependency_failure', 'Place discovery is temporarily unavailable.', true);
    const discovery = validateDiscoveryResult(discovered.value);
    if (!discovery)
      return addFailure('dependency_failure', 'Place discovery returned an invalid response.');
    const now = clock.now();
    const expiresAt = acceptedExpiry(now);
    const session: CatalogIntakeCandidatesSession = {
      sessionId: options.idSource.nextId(),
      sessionVersion: 1,
      state: 'candidates_ready',
      ...scope,
      ownerQuery: input.query,
      normalizedOwnerQuery: input.query,
      requestToken: input.requestToken,
      hasMore: discovery.hasMore,
      candidates: discovery.candidates.map(({ durableIdentity }) => ({
        ...durableIdentity,
        createdAt: now.toISOString(),
      })),
      catalogRevision: await options.catalogRevision.read(),
      createdAt: now.toISOString(),
      lastAcceptedActivityAt: now.toISOString(),
      expiresAt,
    };
    await statePort.create(session);
    return success({
      status: discovery.candidates.length === 0 ? 'clarification_required' : 'candidates_ready',
      sessionId: session.sessionId,
      sessionVersion: 1,
      candidates: discovery.candidates.map(({ durableIdentity, transientPresentation }) => ({
        ordinal: durableIdentity.ordinal,
        transientName: transientPresentation.name,
        transientAddress: transientPresentation.address,
        attribution: transientPresentation.attribution,
      })),
      hasMore: discovery.hasMore,
      expiresAt,
    });
  }

  async function select(
    input: CatalogIntakeSelectInput,
    scope: CatalogIntakeScope,
  ): Promise<AddResult<CatalogIntakeSelectOutput>> {
    const loaded = await activeSession(scope, input.sessionId);
    if (loaded.ok === 'terminal') return terminalFailure(loaded.session);
    if (!loaded.ok) return loaded;
    const session = loaded.value;
    if (session.sessionVersion !== input.expectedSessionVersion) return changed();
    const candidate = session.candidates.find(({ ordinal }) => ordinal === input.ordinal);
    if (!candidate) return addFailure('not_found', 'Catalog intake candidate was not found.');
    const identity = { providerNamespace: candidate.providerNamespace, placeId: candidate.placeId };
    const refreshed = await options.discoveryPort.refetch(identity);
    if (!refreshed.ok)
      return addFailure(
        'dependency_failure',
        'Place discovery is temporarily unavailable.',
        refreshed.error.kind !== 'not_found',
      );
    const place = validateDiscoveryCandidate(refreshed.value);
    if (!place || !sameCandidateIdentity(place.durableIdentity, identity))
      return addFailure('dependency_failure', 'Place discovery returned an invalid response.');

    const ownerFields = input.ownerFields ?? {};
    const selectedSubject = subjectOf(session, place);
    const acceptedAt = clock.now();
    const assertedAt = acceptedAt.toISOString();

    // 1. Coordinates: the Owner's own, or a Nominatim proposal.
    let geocoded: DurableGeocoderProposal | undefined;
    let geocoderUnavailable = !options.durableGeocoderPort;
    if (!ownerFields.coordinates && options.durableGeocoderPort) {
      const proposed = await options.durableGeocoderPort.propose({
        ownerQuery: session.ownerQuery,
        ownerDraft: locationOwnerFields(ownerFields),
        selectedSubject,
      });
      geocoded = proposed.ok ? validateDurableGeocoderProposal(proposed.value) : undefined;
      geocoderUnavailable = !geocoded;
    }
    const resolved = geocoded?.status === 'resolved' ? geocoded : undefined;
    if (geocoded?.status === 'ambiguous' && !options.webResearchPort) {
      const clarification: CatalogIntakeClarification = {
        code: 'ambiguous_location',
        prompt: 'Add an area or address to identify the right place.',
        fields: ['area', 'address'],
      };
      const next: CatalogIntakeCandidatesSession = {
        ...session,
        state: 'candidates_ready',
        sessionVersion: session.sessionVersion + 1,
        lastAcceptedActivityAt: assertedAt,
        expiresAt: acceptedExpiry(acceptedAt),
      };
      const written = await cas(session, scope, next);
      if (written.kind === 'conflict')
        return (await lostCas(written.current, scope)) ? expired() : changed();
      return success({
        status: 'clarification_required',
        sessionId: session.sessionId,
        sessionVersion: next.sessionVersion,
        clarification,
        expiresAt: next.expiresAt,
      });
    }
    let titleProposal: CatalogIntakeTitleProposal | undefined = ownerFields.title
      ? undefined
      : { provenance: 'owner_query', value: session.ownerQuery };
    let addressProposal = resolved ? geocodedAddress(resolved) : undefined;
    let locationEvidence: CatalogIntakeLocationEvidence =
      ownerFields.coordinates && ownerFields.address
        ? {
            status: 'known',
            provenance: 'owner_asserted',
            address: ownerFields.address,
            ...ownerFields.coordinates,
            assertedAt,
          }
        : resolved
          ? geocodedLocation(resolved)
          : { status: 'unknown' };

    // 2. Owner assertions win; otherwise a reselected preview keeps its earlier evidence.
    const prior = session.state === 'preview_ready' ? session.preview : undefined;
    const ownerTabelog: CatalogIntakeTabelogSnapshot =
      input.tabelog && input.tabelog !== 'unknown'
        ? {
            status: 'known',
            ...input.tabelog,
            provenance: 'owner_asserted',
            assertedAt,
            freshness: 'fresh',
          }
        : input.tabelog === undefined && prior
          ? prior.tabelog
          : { status: 'unknown' };
    const ownerReservation: CatalogIntakeReservationSnapshot =
      input.reservation && input.reservation !== 'unknown'
        ? {
            status: 'known',
            ...input.reservation,
            provenance: 'owner_asserted',
            assertedAt,
            freshness: 'fresh',
          }
        : input.reservation === undefined && prior
          ? prior.reservation
          : { status: 'unknown' };

    // 3. Research runs once per session, on the first selection.
    let researched: {
      readonly profile?: CatalogIntakeEnrichedProfile;
      readonly tabelog: CatalogIntakeTabelogSnapshot;
      readonly reservation: CatalogIntakeReservationSnapshot;
    } = { tabelog: { status: 'unknown' }, reservation: { status: 'unknown' } };
    // Why research is incomplete, which picks the warning the Owner sees.
    let researchIssue: 'timed_out' | 'blocked' | 'source_unavailable' | 'failed' | undefined;
    if (
      (options.enrichmentPolicy === 'enrich_if_available' ||
        (options.enrichmentPolicy === undefined && input.requestResearch === true)) &&
      session.state === 'candidates_ready' &&
      options.webResearchPort
    ) {
      const research = await options.webResearchPort.research({
        phase: 'initial',
        selectedSubject,
      });
      if (research.kind !== 'observed') {
        researchIssue = research.reason === 'timed_out' ? 'timed_out' : 'failed';
      } else {
        const normalized = validateWebResearchOutput(research.value, {
          tabelog: ownerTabelog,
          reservation: ownerReservation,
        });
        if (!normalized)
          return addFailure('dependency_failure', 'Web research returned an invalid response.');
        researched = normalized;
        researchIssue =
          research.sourceAccessIssue === 'unavailable'
            ? 'source_unavailable'
            : research.sourceAccessIssue;
      }
    }
    const profile = mergeEnrichedProfile(
      researched.profile,
      prior && sameCandidateIdentity(prior.candidateIdentity, identity) ? prior.profile : undefined,
    );
    if (!ownerFields.title && profile?.name)
      titleProposal = { provenance: 'agent_observed', ...profile.name };
    if (!ownerFields.address && !addressProposal && profile?.address)
      addressProposal = { provenance: 'agent_observed', ...profile.address };
    if (locationEvidence.status === 'unknown' && profile?.address && profile.coordinates)
      locationEvidence = {
        status: 'known',
        provenance: 'agent_observed',
        normalizedAddress: ownerFields.address ?? profile.address.value,
        ...profile.coordinates.value,
        sourceUrl: profile.coordinates.sourceUrl,
        observedAt: profile.coordinates.observedAt,
      };
    // Sourced location evidence resolves the missing-geocoder fallback.
    if (locationEvidence.status === 'known' && locationEvidence.provenance === 'agent_observed')
      geocoderUnavailable = false;
    const tabelog =
      ownerTabelog.status !== 'known' && researched.tabelog.status === 'known'
        ? researched.tabelog
        : ownerTabelog;
    const reservation =
      ownerReservation.status !== 'known' && researched.reservation.status === 'known'
        ? researched.reservation
        : ownerReservation;

    // 4. The preview the Owner reviews.
    const unavailableMessage =
      researchIssue === 'timed_out'
        ? 'Restaurant research timed out. Your selected branch is retained. Retry the lookup, or paste its full Tabelog listing URL to read that exact branch.'
        : researchIssue === 'blocked'
          ? 'Tabelog refused the server request. Automatic research is incomplete; this does not mean the restaurant has no rating or reservation information. Your selected restaurant is retained.'
          : researchIssue === 'source_unavailable'
            ? 'The restaurant source could not be read. Automatic research is incomplete; missing fields are not evidence that the information does not exist.'
            : geocoderUnavailable
              ? 'Durable location lookup is unavailable; review the owner-provided details.'
              : 'Web research is unavailable; review the owner-provided details.';
    const preview = await withDigest({
      sessionId: session.sessionId,
      previewVersion: prior ? prior.previewVersion + 1 : 1,
      state: 'preview_ready',
      candidateIdentity: identity,
      ownerFields,
      ...(profile ? { profile } : {}),
      ...(titleProposal ? { titleProposal } : {}),
      ...(addressProposal ? { addressProposal } : {}),
      locationEvidence,
      tabelog,
      reservation,
      suspectedDuplicates: options.savedPlaceLookup
        ? findSavedPlaceDuplicates(
            {
              candidateIdentity: identity,
              ownerFields,
              addressProposal,
              locationEvidence,
              tabelog,
            },
            await options.savedPlaceLookup.list(),
          )
        : [],
      unknownFields: unknownFieldsOf(
        ownerFields,
        addressProposal,
        locationEvidence,
        tabelog,
        reservation,
      ),
      warnings: canonicalizeCatalogIntakeWarnings([
        ...(geocoderUnavailable || researchIssue
          ? [{ code: 'provider_unavailable' as const, message: unavailableMessage }]
          : []),
        {
          code: 'needs_review' as const,
          message: 'Confirm or complete the durable place details before publishing.',
        },
      ]),
      catalogRevision: session.catalogRevision,
      expiresAt: acceptedExpiry(acceptedAt),
    });
    const next: CatalogIntakePreviewSession = {
      ...session,
      state: 'preview_ready',
      sessionVersion: session.sessionVersion + 1,
      lastAcceptedActivityAt: assertedAt,
      expiresAt: preview.expiresAt,
      preview,
    };
    const written = await cas(session, scope, next);
    if (written.kind === 'conflict')
      return (await lostCas(written.current, scope)) ? expired() : changed();
    return success({
      status: 'preview_ready',
      sessionId: session.sessionId,
      sessionVersion: next.sessionVersion,
      preview,
      expiresAt: next.expiresAt,
    });
  }

  async function confirm(
    input: CatalogIntakeConfirmInput,
    scope: CatalogIntakeScope,
  ): Promise<AddResult<CatalogIntakeConfirmOutput>> {
    const loaded = await activeSession(scope, input.sessionId);
    if (loaded.ok === 'terminal') {
      const terminal = loaded.session;
      if (terminal.state !== 'committed') return terminalFailure(terminal);
      // A repeated confirm of the committed preview replays its receipt.
      if (terminal.previewVersion !== input.expectedPreviewVersion) return previewChanged();
      const key = await deriveAddConfirmMutationKeyFromParts(
        scope,
        terminal.sessionId,
        terminal.previewVersion,
        terminal.evidenceDigest,
      );
      return key === terminal.mutationKey
        ? success({ ...terminal.outcome, replayed: true })
        : changed('Catalog intake confirmation conflicts with the committed receipt.');
    }
    if (!loaded.ok) return loaded;
    let session = loaded.value;
    if (
      session.state !== 'preview_ready' ||
      session.preview.previewVersion !== input.expectedPreviewVersion
    )
      return previewChanged();
    const prior = session.preview;

    // 1. The place must still exist under the same identity.
    const refetched = await options.discoveryPort.refetch(prior.candidateIdentity);
    const place = refetched.ok ? validateDiscoveryCandidate(refetched.value) : undefined;
    if (!place) return noWrite('dependency');
    const identity = {
      providerNamespace: place.durableIdentity.providerNamespace,
      placeId: place.durableIdentity.placeId,
    };
    const now = clock.now();
    if (!sameCandidateIdentity(identity, prior.candidateIdentity)) {
      const { evidenceDigest: _digest, ...rest } = prior;
      return republish(
        session,
        scope,
        await withDigest({
          ...rest,
          previewVersion: prior.previewVersion + 1,
          candidateIdentity: identity,
          expiresAt: acceptedExpiry(now),
        }),
        false,
      );
    }
    const subject = subjectOf(session, place);

    // 2. Geocoded coordinates are re-checked.
    let address = prior.addressProposal;
    let location = prior.locationEvidence;
    let tabelog = prior.tabelog;
    let reservation = prior.reservation;
    let profile = prior.profile;
    let refreshFailed = false;
    const geocodedBefore =
      location.status === 'unknown' || location.provenance === 'durable_geocoder_observed';
    if (options.durableGeocoderPort && geocodedBefore) {
      const proposed = await options.durableGeocoderPort.propose({
        ownerQuery: session.ownerQuery,
        ownerDraft: locationOwnerFields(prior.ownerFields),
        selectedSubject: subject,
      });
      const proposal = proposed.ok ? validateDurableGeocoderProposal(proposed.value) : undefined;
      if (!proposal) return noWrite('dependency');
      if (proposal.status === 'no_match' && location.status === 'known') {
        address = undefined;
        location = { status: 'unknown' };
      } else if (proposal.status === 'resolved') {
        // Re-observing the same facts keeps the reviewed evidence (and its digest) unchanged.
        const before = location;
        const sameFacts =
          before.status === 'known' &&
          before.provenance === 'durable_geocoder_observed' &&
          (
            [
              'normalizedAddress',
              'latitude',
              'longitude',
              'provider',
              'sourceUrl',
              'license',
            ] as const
          ).every((key) => before[key] === proposal[key]);
        if (!sameFacts) {
          address = geocodedAddress(proposal);
          location = geocodedLocation(proposal);
        }
      }
      refreshFailed ||= proposal.status === 'ambiguous';
    }

    // 3. Researched Tabelog/booking pages are re-read once per preview version.
    const urls = catalogIntakeCanonicalResearchUrls(prior);
    let researchAttempted = false;
    let researchApplied = false;
    if (
      options.enrichmentPolicy !== 'disabled' &&
      options.webResearchPort &&
      urls.length > 0 &&
      session.confirmResearchedVersion !== prior.previewVersion
    ) {
      researchAttempted = true;
      const research = await options.webResearchPort.research({
        phase: 'confirm',
        canonicalUrls: urls,
        preview: prior,
        selectedSubject: subject,
      });
      if (research.kind !== 'observed' || research.sourceAccessIssue) {
        refreshFailed = true;
        tabelog = markAgentTabelogStale(prior.tabelog);
        reservation = markAgentReservationStale(prior.reservation);
      } else {
        const normalized = validateWebResearchOutput(research.value, prior);
        if (!normalized) return noWrite('dependency');
        researchApplied = true;
        ({ tabelog, reservation } = stabilizeResearchEvidence(normalized, prior));
        profile = mergeEnrichedProfile(normalized.profile, profile);
      }
    }
    const warnings = !(options.durableGeocoderPort || researchAttempted)
      ? prior.warnings
      : refreshFailed
        ? withConfirmProviderUnavailableWarning(
            prior.warnings,
            hasStaleAgentEvidence(tabelog, reservation),
          )
        : withoutRefreshFailureWarnings(prior.warnings);

    // 4. Anything that changed goes back to the Owner as a new preview.
    if (
      canonicalJson([address, location, tabelog, reservation, profile, warnings]) !==
      canonicalJson([
        prior.addressProposal,
        prior.locationEvidence,
        prior.tabelog,
        prior.reservation,
        prior.profile,
        prior.warnings,
      ])
    ) {
      const {
        evidenceDigest: _digest,
        addressProposal: _address,
        profile: _profile,
        ...rest
      } = prior;
      return republish(
        session,
        scope,
        await withDigest({
          ...rest,
          previewVersion: prior.previewVersion + 1,
          ...(address ? { addressProposal: address } : {}),
          ...(profile ? { profile } : {}),
          locationEvidence: location,
          tabelog,
          reservation,
          unknownFields: unknownFieldsOf(
            prior.ownerFields,
            address,
            location,
            tabelog,
            reservation,
          ),
          warnings,
          expiresAt: acceptedExpiry(now),
        }),
        researchApplied,
      );
    }
    if (researchApplied) {
      const marked: CatalogIntakePreviewSession = {
        ...session,
        sessionVersion: session.sessionVersion + 1,
        confirmResearchedVersion: prior.previewVersion,
      };
      const written = await cas(session, scope, marked);
      if (written.kind !== 'applied')
        return (await lostCas(written.current, scope)) ? expired() : previewChanged();
      session = marked;
    }

    // 5. Publish once: duplicates and incomplete places never write.
    if (!options.atlasCatalogIntakePort) return noWrite('dependency');
    if (options.savedPlaceLookup) {
      const existing = findSavedPlaceDuplicates(
        session.preview,
        await options.savedPlaceLookup.list(),
      ).find(({ match }) => match === 'strong');
      if (existing) return success({ status: 'already_saved', itemId: existing.itemId });
    }
    if (!hasPublishableLocation(session.preview)) return noWrite('validation');
    const mutationKey = await deriveAddConfirmMutationKey(scope, session.preview);
    if (session.confirmMutationKey !== mutationKey) {
      const claimed: CatalogIntakePreviewSession = {
        ...session,
        sessionVersion: session.sessionVersion + 1,
        confirmMutationKey: mutationKey,
      };
      const written = await cas(session, scope, claimed);
      if (written.kind !== 'applied')
        return (await lostCas(written.current, scope)) ? expired() : previewChanged();
      session = claimed;
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

  async function cancel(
    input: CatalogIntakeCancelInput,
    scope: CatalogIntakeScope,
  ): Promise<AddResult<CatalogIntakeCancelOutput>> {
    const cancelledReplay = (session: CatalogIntakeStoredSession | undefined) =>
      session?.state === 'cancelled' &&
      session.cancelledFromVersion === input.expectedSessionVersion
        ? success({
            status: 'cancelled' as const,
            sessionId: session.sessionId,
            replayed: true,
          })
        : undefined;
    const loaded = await activeSession(scope, input.sessionId);
    if (loaded.ok === 'terminal')
      return (
        cancelledReplay(loaded.session) ??
        (loaded.session.state === 'cancelled' ? changed() : terminalFailure(loaded.session))
      );
    if (!loaded.ok) return loaded;
    const session = loaded.value;
    if (session.sessionVersion !== input.expectedSessionVersion) return changed();
    const terminalAt = clock.now();
    const written = await cas(session, scope, {
      state: 'cancelled',
      sessionId: session.sessionId,
      sessionVersion: session.sessionVersion + 1,
      ...scope,
      cancelledFromVersion: input.expectedSessionVersion,
      requestToken: session.requestToken,
      normalizedOwnerQuery: session.normalizedOwnerQuery,
      terminalAt: terminalAt.toISOString(),
      retainUntil: receiptRetention(terminalAt),
    });
    if (written.kind === 'conflict') {
      if (await lostCas(written.current, scope)) return expired();
      return cancelledReplay(written.current) ?? changed();
    }
    return success({ status: 'cancelled', sessionId: session.sessionId, replayed: false });
  }
  return {
    discover: guarded(discover, 'Catalog intake dependencies are temporarily unavailable.'),
    select: guarded(select, 'Catalog intake state is temporarily unavailable.'),
    confirm: guarded(confirm, 'Catalog intake state is temporarily unavailable.'),
    cancel: guarded(cancel, 'Catalog intake state is temporarily unavailable.'),
  };
}

export type CatalogIntakeOperation = 'discover' | 'select' | 'confirm' | 'cancel';

export interface CatalogIntakeInvocation {
  readonly ownerId: string;
  readonly channel: string;
  readonly conversationId: string;
}

/** Validate one operation's input, then run it in the caller's conversation scope. */
export function executeCatalogIntake(
  module: CatalogIntakeModule,
  operation: CatalogIntakeOperation,
  input: unknown,
  invocation: CatalogIntakeInvocation | undefined,
): Promise<AddResult<unknown>> {
  const ownerId = normalizeBoundedText(invocation?.ownerId, 1, 200);
  const channel = normalizeBoundedText(invocation?.channel, 1, 120);
  const conversationId = normalizeBoundedText(invocation?.conversationId, 1, 200);
  const run = <T>(
    validated: AddResult<T>,
    handle: (value: T, scope: CatalogIntakeScope) => Promise<AddResult<unknown>>,
  ) => {
    if (!validated.ok) return Promise.resolve(validated);
    if (!ownerId || !channel || !conversationId)
      return Promise.resolve(
        addFailure('unauthorized', 'Catalog intake requires an authenticated conversation.'),
      );
    return handle(validated.value, { ownerId, channel, conversationId });
  };
  switch (operation) {
    case 'discover':
      return run(validateDiscoverInput(input), (value, scope) => module.discover(value, scope));
    case 'select':
      return run(validateSelectInput(input), (value, scope) => module.select(value, scope));
    case 'confirm':
      return run(validateConfirmInput(input), (value, scope) => module.confirm(value, scope));
    case 'cancel':
      return run(validateCancelInput(input), (value, scope) => module.cancel(value, scope));
  }
}

// --- Helpers -----------------------------------------------------------------------------------

/** A failed port read or write becomes a closed, retryable dependency failure. */
function guarded<I, T>(
  step: (input: I, scope: CatalogIntakeScope) => Promise<AddResult<T>>,
  message: string,
) {
  return async (input: I, scope: CatalogIntakeScope): Promise<AddResult<T>> => {
    try {
      return await step(input, scope);
    } catch {
      return addFailure('dependency_failure', message, true);
    }
  };
}

function isActive(session: CatalogIntakeStoredSession | undefined): session is ActiveSession {
  return session?.state === 'candidates_ready' || session?.state === 'preview_ready';
}

function terminalFailure(session: CatalogIntakeStoredSession) {
  if (session.state === 'expired') return expired();
  if (session.state === 'cancelled') return changed('Catalog intake session is cancelled.');
  return changed('Catalog intake session is already committed.');
}

/** Moves a session past its expiry to `expired`; a concurrent cancel wins. */
async function expireIfNeeded(
  session: ActiveSession,
  scope: CatalogIntakeScope,
  options: Pick<CatalogIntakeOptions, 'statePort' | 'clock'>,
): Promise<'active' | 'expired' | 'conflict' | CatalogIntakeCancelledSession> {
  const now = options.clock.now();
  if (now.getTime() < Date.parse(session.expiresAt)) return 'active';
  const written = await options.statePort.compareAndSwap({
    scope,
    sessionId: session.sessionId,
    expectedVersion: session.sessionVersion,
    next: {
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
    },
  });
  if (written.kind === 'applied') return 'expired';
  const current = written.current;
  if (current?.state === 'expired') return 'expired';
  if (current?.state === 'cancelled') return current;
  if (isActive(current) && now.getTime() < Date.parse(current.expiresAt)) return 'active';
  return 'conflict';
}

function subjectOf(
  session: ActiveSession,
  place: GooglePlaceDiscoveryCandidate,
): CatalogIntakeSelectedSubject {
  return {
    ownerQuery: session.ownerQuery,
    providerNamespace: place.durableIdentity.providerNamespace,
    placeId: place.durableIdentity.placeId,
    transientName: place.transientPresentation.name,
    transientAddress: place.transientPresentation.address,
  };
}

type Resolved = Extract<DurableGeocoderProposal, { readonly status: 'resolved' }>;

function geocodedAddress(resolved: Resolved): CatalogIntakeAddressProposal {
  return {
    provenance: 'durable_geocoder_observed',
    value: resolved.normalizedAddress,
    sourceUrl: resolved.sourceUrl,
    license: resolved.license,
    checkedAt: resolved.checkedAt,
  };
}

function geocodedLocation(resolved: Resolved) {
  return {
    status: 'known' as const,
    provenance: 'durable_geocoder_observed' as const,
    normalizedAddress: resolved.normalizedAddress,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    provider: resolved.provider,
    sourceUrl: resolved.sourceUrl,
    license: resolved.license,
    checkedAt: resolved.checkedAt,
  };
}

function unknownFieldsOf(
  ownerFields: CatalogIntakeOwnerFields,
  address: CatalogIntakeAddressProposal | undefined,
  location: CatalogIntakeLocationEvidence,
  tabelog: CatalogIntakeTabelogSnapshot,
  reservation: CatalogIntakeReservationSnapshot,
): CatalogIntakePreview['unknownFields'] {
  return [
    ...(!ownerFields.address && !address ? (['address'] as const) : []),
    ...(location.status === 'unknown' ? (['coordinates'] as const) : []),
    ...(tabelog.status === 'unknown' ? (['tabelog'] as const) : []),
    ...(reservation.status === 'unknown' ? (['reservation'] as const) : []),
  ];
}

async function withDigest(
  preview: Omit<CatalogIntakePreview, 'evidenceDigest'>,
): Promise<CatalogIntakePreview> {
  return { ...preview, evidenceDigest: await digestCanonical(preview) };
}

/** A publishable place has a title, an address and known coordinates, and no open conflict. */
export function hasPublishableLocation(preview: CatalogIntakePreview): boolean {
  return Boolean(
    (preview.ownerFields.title ?? preview.titleProposal?.value) &&
    (preview.ownerFields.address ?? preview.addressProposal?.value) &&
    preview.locationEvidence.status === 'known' &&
    !preview.clarification &&
    !preview.warnings.some(({ code }) => code === 'source_conflict'),
  );
}

export function acceptedExpiry(now: Date): string {
  return new Date(now.getTime() + 30 * 60 * 1000).toISOString();
}

export function receiptRetention(now: Date): string {
  return new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000).toISOString();
}
