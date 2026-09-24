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
  readonly title: string;
  readonly area: string;
  readonly address: string;
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
        | 'reused_existing';
    }
  >;
  readonly focusRevision: number;
}

export type CatalogIntakeUiAction =
  | {
      readonly type: 'field_changed';
      readonly field: 'query' | 'title' | 'area' | 'address';
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

export function catalogIntakeInitialState(): CatalogIntakeUiState {
  return {
    stage: 'idle',
    query: '',
    title: '',
    area: '',
    address: '',
    candidates: [],
    hasMore: false,
    focusRevision: 0,
  };
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
        ...(action.field === 'query' && action.value !== state.query
          ? { requestToken: undefined }
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
        selectedOrdinal: candidates[0]?.ordinal,
        clarification: undefined,
        preview: undefined,
        error: undefined,
      });
    }
    case 'select_succeeded':
      return action.output.status === 'clarification_required'
        ? toStage(state, 'clarification', {
            sessionId: action.output.sessionId,
            sessionVersion: action.output.sessionVersion,
            clarification: action.output.clarification,
            preview: undefined,
            error: undefined,
          })
        : toStage(state, 'preview', {
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
