import type {
  AddErrorCode,
  CatalogIntakeCandidateOutput,
  CatalogIntakeClarification,
  CatalogIntakeConfirmOutput,
  CatalogIntakeDiscoverOutput,
  CatalogIntakePreview,
  CatalogIntakeSelectOutput,
} from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';

export type CatalogIntakeUiStage =
  | 'idle'
  | 'loading'
  | 'empty'
  | 'candidates'
  | 'error'
  | 'clarification'
  | 'preview'
  | 'expired'
  | 'conflict'
  | 'success';

export interface CatalogIntakeUiError {
  readonly code: AddErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
}

export interface CatalogIntakeUiState {
  readonly stage: CatalogIntakeUiStage;
  readonly previousStage?: CatalogIntakeUiStage;
  readonly lastOperation?: 'discover' | 'select' | 'confirm' | 'cancel';
  readonly query: string;
  readonly searchArea: string;
  readonly title: string;
  readonly area: string;
  readonly address: string;
  readonly categories: string;
  readonly signatureDishes: string;
  readonly summary: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly tabelogScore: string;
  readonly tabelogUrl: string;
  readonly reservationMode:
    | 'unknown'
    | 'reservable'
    | 'reservation_required'
    | 'not_reservable';
  readonly reservationLabel: string;
  readonly reservationUrl: string;
  readonly previewNeedsRefresh: boolean;
  readonly requestToken?: string;
  readonly sessionId?: string;
  readonly sessionVersion?: number;
  readonly candidates: readonly CatalogIntakeCandidateOutput[];
  readonly hasMore: boolean;
  readonly selectedOrdinal?: number;
  readonly clarification?: CatalogIntakeClarification;
  readonly preview?: CatalogIntakePreview;
  readonly error?: CatalogIntakeUiError;
  readonly success?: Extract<
    CatalogIntakeConfirmOutput,
    {
      readonly status:
        | 'committed_verified'
        | 'committed_needs_review'
        | 'reused_existing'
        | 'already_saved';
    }
  >;
  readonly focusRevision: number;
}

export type CatalogIntakeUiAction =
  | {
      readonly type: 'field_changed';
      readonly field:
        | 'query'
        | 'searchArea'
        | 'title'
        | 'area'
        | 'address'
        | 'categories'
        | 'signatureDishes'
        | 'summary'
        | 'latitude'
        | 'longitude'
        | 'tabelogScore'
        | 'tabelogUrl'
        | 'reservationMode'
        | 'reservationLabel'
        | 'reservationUrl';
      readonly value: string;
    }
  | { readonly type: 'candidate_selected'; readonly ordinal: number }
  | { readonly type: 'discover_started'; readonly requestToken: string }
  | { readonly type: 'select_started' }
  | { readonly type: 'confirm_started' }
  | { readonly type: 'cancel_started' }
  | {
      readonly type: 'discover_succeeded';
      readonly output: CatalogIntakeDiscoverOutput;
    }
  | {
      readonly type: 'select_succeeded';
      readonly output: CatalogIntakeSelectOutput;
    }
  | {
      readonly type: 'confirm_succeeded';
      readonly output: CatalogIntakeConfirmOutput;
    }
  | { readonly type: 'request_failed'; readonly error: CatalogIntakeUiError }
  | { readonly type: 'cancelled' }
  | { readonly type: 'restart' };

export function catalogIntakePendingMessage(
  operation: CatalogIntakeUiState['lastOperation'],
): string {
  const messages = {
    discover: 'Finding matches…',
    select: 'Agent is gathering restaurant information…',
    confirm: 'Confirming and saving…',
    cancel: 'Cancelling this Add session…',
  } as const;
  return operation
    ? messages[operation]
    : 'Preparing the next step in Add a place…';
}

export function catalogIntakeLiveMessage(state: CatalogIntakeUiState): string {
  switch (state.stage) {
    case 'idle':
      return '';
    case 'loading':
      return catalogIntakePendingMessage(state.lastOperation);
    case 'empty':
      return 'No matches found. Refine the restaurant name, neighborhood, or address.';
    case 'candidates':
      return `${state.candidates.length} possible ${state.candidates.length === 1 ? 'match' : 'matches'} found. Choose the intended place.`;
    case 'error':
      return (
        state.error?.message ?? 'The Add request failed. Nothing was saved.'
      );
    case 'clarification':
      return (
        state.clarification?.prompt ??
        'Clarification is required before the preview can be built.'
      );
    case 'preview':
      if (
        state.preview?.suspectedDuplicates.some(
          (item) => item.match === 'strong',
        )
      )
        return 'This restaurant is already in your Atlas. Open the saved place or cancel.';
      if (state.preview?.locationEvidence.status === 'unknown') {
        return 'Research incomplete. We could not verify this restaurant’s location. Nothing has been saved.';
      }
      return 'Preview ready. Review the place facts before saving.';
    case 'expired':
      return state.error?.message ?? 'The preview expired.';
    case 'conflict':
      return 'Evidence changed. Review the refreshed preview before confirming again.';
    case 'success':
      if (state.success?.status === 'committed_verified') {
        return 'Place saved and available on the verified map and Nearby.';
      }
      if (state.success?.status === 'committed_needs_review') {
        return 'This legacy save is not map-ready. Retry Add.';
      }
      if (state.success?.status === 'already_saved') {
        return 'This restaurant is already saved. Nothing new was added.';
      }
      return 'Existing place reused; no duplicate was created.';
  }
}

export function catalogIntakeInitialState(): CatalogIntakeUiState {
  return {
    stage: 'idle',
    query: '',
    searchArea: '',
    title: '',
    area: '',
    address: '',
    categories: '',
    signatureDishes: '',
    summary: '',
    latitude: '',
    longitude: '',
    tabelogScore: '',
    tabelogUrl: '',
    reservationMode: 'unknown',
    reservationLabel: '',
    reservationUrl: '',
    previewNeedsRefresh: false,
    candidates: [],
    hasMore: false,
    focusRevision: 0,
  };
}

export function catalogIntakeManualCompletionError(
  state: CatalogIntakeUiState,
): string | undefined {
  for (const [label, value] of [
    ['Categories', state.categories],
    ['Signature dishes', state.signatureDishes],
  ] as const) {
    const entries = catalogIntakeManualLabels(value);
    if (entries.length > 12 || entries.some((entry) => entry.length > 100)) {
      return `${label} must have at most 12 entries of 100 characters each.`;
    }
  }
  if (state.summary.trim().length > 1200 || /\p{Cc}/u.test(state.summary)) {
    return 'The overview must be one line and at most 1,200 characters.';
  }
  const latitude = state.latitude.trim();
  const longitude = state.longitude.trim();
  if (latitude || longitude) {
    if (!latitude || !longitude || !state.address.trim()) {
      return 'Enter an address and both coordinates, or leave coordinates empty for address lookup.';
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return 'Latitude must be between -90 and 90; longitude between -180 and 180.';
    }
  }
  if (state.tabelogScore.trim() || state.tabelogUrl.trim()) {
    const score = Number(state.tabelogScore);
    if (
      !state.tabelogScore.trim() ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 5 ||
      !state.tabelogUrl.trim().startsWith('https://tabelog.com/')
    ) {
      return 'A manual Tabelog score needs a 0–5 score and its main listing URL.';
    }
  }
  if (
    state.reservationMode === 'unknown' &&
    (state.reservationLabel.trim() || state.reservationUrl.trim())
  ) {
    return 'Choose a reservation rule, or clear the explanation and source URL.';
  }
  if (state.reservationMode !== 'unknown') {
    if (
      !state.reservationLabel.trim() ||
      !state.reservationUrl.trim().startsWith('https://')
    ) {
      return 'A manual reservation rule needs a short explanation and HTTPS source URL.';
    }
  }
  return undefined;
}

export function catalogIntakeManualLabels(value: string): string[] {
  return value
    .split(/[,，、]/u)
    .map((entry) => entry.normalize('NFC').trim())
    .filter(Boolean);
}

export function reduceCatalogIntakeUi(
  state: CatalogIntakeUiState,
  action: CatalogIntakeUiAction,
): CatalogIntakeUiState {
  switch (action.type) {
    case 'field_changed':
      return {
        ...state,
        [action.field]: action.value,
        previewNeedsRefresh:
          state.previewNeedsRefresh ||
          (action.field !== 'query' &&
            action.field !== 'searchArea' &&
            action.value !== state[action.field] &&
            (state.stage === 'preview' || state.stage === 'conflict')),
        ...((action.field === 'query' || action.field === 'searchArea') &&
        action.value !== state[action.field]
          ? {
              requestToken: undefined,
              stage: 'idle' as const,
              preview: undefined,
              candidates: [],
              selectedOrdinal: undefined,
              title: '',
              area: '',
              address: '',
              categories: '',
              signatureDishes: '',
              summary: '',
              latitude: '',
              longitude: '',
              tabelogScore: '',
              tabelogUrl: '',
              reservationMode: 'unknown',
              reservationLabel: '',
              reservationUrl: '',
              previewNeedsRefresh: false,
            }
          : {}),
      };
    case 'candidate_selected':
      return { ...state, selectedOrdinal: action.ordinal };
    case 'discover_started':
      return toStage(state, 'loading', {
        previousStage: state.stage,
        lastOperation: 'discover',
        requestToken: action.requestToken,
        error: undefined,
      });
    case 'select_started':
      return toStage(state, 'loading', {
        previousStage: state.stage,
        lastOperation: 'select',
        error: undefined,
      });
    case 'confirm_started':
      return toStage(state, 'loading', {
        previousStage: state.stage,
        lastOperation: 'confirm',
        error: undefined,
      });
    case 'cancel_started':
      return toStage(state, 'loading', {
        previousStage: state.stage,
        lastOperation: 'cancel',
        error: undefined,
      });
    case 'discover_succeeded': {
      const candidates = action.output.candidates;
      return toStage(state, candidates.length ? 'candidates' : 'empty', {
        sessionId: action.output.sessionId,
        sessionVersion: action.output.sessionVersion,
        candidates,
        hasMore: action.output.hasMore,
        selectedOrdinal:
          candidates.length === 1 ? candidates[0]?.ordinal : undefined,
        clarification: undefined,
        preview: undefined,
        error: undefined,
      });
    }
    case 'select_succeeded':
      return action.output.status === 'clarification_required'
        ? toStage(state, 'clarification', {
            previewNeedsRefresh: false,
            sessionId: action.output.sessionId,
            sessionVersion: action.output.sessionVersion,
            clarification: action.output.clarification,
            preview: undefined,
            error: undefined,
          })
        : toStage(state, 'preview', {
            previewNeedsRefresh: false,
            sessionId: action.output.sessionId,
            sessionVersion: action.output.sessionVersion,
            clarification: undefined,
            preview: action.output.preview,
            error: undefined,
          });
    case 'confirm_succeeded':
      if (action.output.status === 'conflict') {
        return toStage(state, 'conflict', {
          preview: action.output.newPreview,
          sessionVersion: action.output.newPreview.previewVersion,
          error: undefined,
        });
      }
      if (action.output.status === 'failed_no_write') {
        return toStage(state, 'error', {
          error: {
            code: 'dependency_failure',
            message: 'Nothing was saved. Review the preview and try again.',
            retryable: true,
          },
        });
      }
      return toStage(state, 'success', { success: action.output });
    case 'request_failed':
      return toStage(
        state,
        action.error.code === 'expired'
          ? 'expired'
          : action.error.code === 'conflict'
            ? 'conflict'
            : 'error',
        { error: action.error },
      );
    case 'cancelled':
      return catalogIntakeInitialState();
    case 'restart':
      return {
        ...catalogIntakeInitialState(),
        query: state.query,
        title: state.title,
        area: state.area,
        address: state.address,
        categories: state.categories,
        signatureDishes: state.signatureDishes,
        summary: state.summary,
        latitude: state.latitude,
        longitude: state.longitude,
        tabelogScore: state.tabelogScore,
        tabelogUrl: state.tabelogUrl,
        reservationMode: state.reservationMode,
        reservationLabel: state.reservationLabel,
        reservationUrl: state.reservationUrl,
        focusRevision: state.focusRevision + 1,
      };
  }
}

function toStage(
  state: CatalogIntakeUiState,
  stage: CatalogIntakeUiStage,
  patch: Partial<CatalogIntakeUiState>,
): CatalogIntakeUiState {
  return {
    ...state,
    ...patch,
    stage,
    focusRevision: state.focusRevision + 1,
  };
}
