import { useCallback, useReducer } from 'react';
import type { CatalogIntakeConfirmOutput } from '../../shared/catalog-intake.ts';
import { AddRequestError, addApi } from '../api.ts';
import { catalogIntakeSelectionDetails } from './add-editor.ts';
import {
  type CatalogIntakeUiError,
  type CatalogIntakeUiState,
  catalogIntakeInitialState,
  catalogIntakeManualCompletionError,
  reduceCatalogIntakeUi,
} from './add-state.ts';

export type CommittedAdd = Extract<
  CatalogIntakeConfirmOutput,
  { readonly status: 'committed_verified' | 'committed_needs_review' | 'reused_existing' }
>;

export type AddField = Extract<
  Parameters<typeof reduceCatalogIntakeUi>[1],
  { type: 'field_changed' }
>['field'];

/** Add view-model: discover → select (research) → review/edit → confirm, or cancel. */
export function useAdd(onCommitted?: (output: CommittedAdd) => void) {
  const [state, dispatch] = useReducer(reduceCatalogIntakeUi, undefined, catalogIntakeInitialState);

  const performDiscover = useCallback(
    async (requestToken: string) => {
      const name = state.query.normalize('NFC').trim();
      const query = URL.canParse(name)
        ? name
        : [name, state.searchArea.normalize('NFC').trim()].filter(Boolean).join(' ');
      if (!name) {
        dispatch({
          type: 'request_failed',
          error: {
            code: 'invalid_input',
            message: 'Enter a restaurant name or address.',
            retryable: false,
          },
        });
        return;
      }
      dispatch({ type: 'discover_started', requestToken });
      try {
        dispatch({
          type: 'discover_succeeded',
          output: await addApi.discover({ query, requestToken }),
        });
      } catch (error) {
        dispatch({ type: 'request_failed', error: toUiError(error) });
      }
    },
    [state.query, state.searchArea],
  );

  const discover = useCallback(
    () => performDiscover(state.requestToken ?? crypto.randomUUID()),
    [performDiscover, state.requestToken],
  );
  const startFresh = useCallback(() => performDiscover(crypto.randomUUID()), [performDiscover]);

  const select = useCallback(async () => {
    if (
      !state.sessionId ||
      state.sessionVersion === undefined ||
      state.selectedOrdinal === undefined
    )
      return;
    const manualError = catalogIntakeManualCompletionError(state);
    if (manualError) {
      dispatch({
        type: 'request_failed',
        error: { code: 'invalid_input', message: manualError, retryable: false },
      });
      return;
    }
    dispatch({ type: 'select_started' });
    try {
      const output = await addApi.select({
        sessionId: state.sessionId,
        expectedSessionVersion: state.sessionVersion,
        ordinal: state.selectedOrdinal,
        ...catalogIntakeSelectionDetails(state),
        requestResearch: true,
      } as Parameters<typeof addApi.select>[0]);
      dispatch({ type: 'select_succeeded', output });
    } catch (error) {
      dispatch({ type: 'request_failed', error: toUiError(error) });
    }
  }, [state]);

  const cancel = useCallback(async () => {
    if (!state.sessionId || state.sessionVersion === undefined) {
      dispatch({ type: 'cancelled' });
      return;
    }
    dispatch({ type: 'cancel_started' });
    try {
      await addApi.cancel({
        sessionId: state.sessionId,
        expectedSessionVersion: state.sessionVersion,
      });
      dispatch({ type: 'cancelled' });
    } catch (error) {
      dispatch({ type: 'request_failed', error: toUiError(error) });
    }
  }, [state.sessionId, state.sessionVersion]);

  const confirm = useCallback(async () => {
    if (!state.preview || state.previewNeedsRefresh) return;
    dispatch({ type: 'confirm_started' });
    try {
      const output = await addApi.confirm({
        sessionId: state.preview.sessionId,
        expectedPreviewVersion: state.preview.previewVersion,
      });
      dispatch({ type: 'confirm_succeeded', output });
      if (
        output.status === 'committed_verified' ||
        output.status === 'committed_needs_review' ||
        output.status === 'reused_existing'
      )
        onCommitted?.(output);
    } catch (error) {
      dispatch({ type: 'request_failed', error: toUiError(error) });
    }
  }, [onCommitted, state.preview, state.previewNeedsRefresh]);

  const retry = useCallback(() => {
    if (state.lastOperation === 'select') return select();
    if (state.lastOperation === 'confirm') return confirm();
    if (state.lastOperation === 'cancel') return cancel();
    return discover();
  }, [cancel, confirm, discover, select, state.lastOperation]);

  return {
    state: state as CatalogIntakeUiState,
    discover,
    select,
    cancel,
    confirm,
    retry,
    startFresh,
    restart: () => dispatch({ type: 'restart' }),
    setField: (field: AddField, value: string) => dispatch({ type: 'field_changed', field, value }),
    selectCandidate: (ordinal: number) => dispatch({ type: 'candidate_selected', ordinal }),
  };
}

export type AddController = ReturnType<typeof useAdd>;

function toUiError(error: unknown): CatalogIntakeUiError {
  return error instanceof AddRequestError
    ? {
        code: error.code,
        message: error.message,
        ...(error.reference ? { reference: error.reference } : {}),
        ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
      }
    : {
        code: 'unexpected_failure',
        message: 'The Add response could not be read. Please retry.',
        retryable: true,
      };
}
