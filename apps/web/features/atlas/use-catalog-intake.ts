'use client';

import { useCallback, useReducer } from 'react';
import { catalogIntakeSelectionDetails } from './catalog-intake-editor';

import {
  browserAtlasApplication,
  CatalogIntakeRequestError,
} from './atlas-api-client';
import {
  catalogIntakeInitialState,
  catalogIntakeManualCompletionError,
  reduceCatalogIntakeUi,
  type CatalogIntakeUiError,
} from './catalog-intake-ui-state';
import type { CatalogIntakeConfirmOutput } from '../../product/application/catalog-intake/catalog-intake-coordinator';

type CommittedCatalogIntakeOutput = Exclude<
  CatalogIntakeConfirmOutput,
  { readonly status: 'conflict' | 'failed_no_write' | 'already_saved' }
>;

export function useCatalogIntake(
  onCommitted?: (output: CommittedCatalogIntakeOutput) => void,
) {
  const [state, dispatch] = useReducer(
    reduceCatalogIntakeUi,
    undefined,
    catalogIntakeInitialState,
  );

  const performDiscover = useCallback(
    async (requestToken: string) => {
      const name = state.query.normalize('NFC').trim();
      const query = [name, state.searchArea.normalize('NFC').trim()]
        .filter(Boolean)
        .join(' ');
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
        const output = await browserAtlasApplication.execute({
          key: 'catalog.intake.discover',
          input: { query, requestToken },
        });
        dispatch({ type: 'discover_succeeded', output });
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

  const startFresh = useCallback(
    () => performDiscover(crypto.randomUUID()),
    [performDiscover],
  );

  const select = useCallback(async () => {
    if (
      !state.sessionId ||
      state.sessionVersion === undefined ||
      state.selectedOrdinal === undefined
    ) {
      return;
    }
    const manualError = catalogIntakeManualCompletionError(state);
    if (manualError) {
      dispatch({
        type: 'request_failed',
        error: {
          code: 'invalid_input',
          message: manualError,
          retryable: false,
        },
      });
      return;
    }
    dispatch({ type: 'select_started' });
    try {
      const output = await browserAtlasApplication.execute({
        key: 'catalog.intake.select',
        input: {
          sessionId: state.sessionId,
          expectedSessionVersion: state.sessionVersion,
          ordinal: state.selectedOrdinal,
          ...catalogIntakeSelectionDetails(state),
          requestResearch: true,
        },
      });
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
      await browserAtlasApplication.execute({
        key: 'catalog.intake.cancel',
        input: {
          sessionId: state.sessionId,
          expectedSessionVersion: state.sessionVersion,
        },
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
      const output = await browserAtlasApplication.execute({
        key: 'catalog.intake.confirm',
        input: {
          sessionId: state.preview.sessionId,
          expectedPreviewVersion: state.preview.previewVersion,
        },
      });
      dispatch({ type: 'confirm_succeeded', output });
      if (
        output.status === 'committed_verified' ||
        output.status === 'committed_needs_review' ||
        output.status === 'reused_existing'
      ) {
        onCommitted?.(output);
      }
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
    state,
    discover,
    select,
    cancel,
    confirm,
    retry,
    startFresh,
    restart: () => dispatch({ type: 'restart' }),
    setField: (
      field:
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
        | 'reservationUrl'
        | 'openingHours'
        | 'openingHoursSourceUrl'
        | 'regularClosingDays'
        | 'regularClosingDaysSourceUrl',
      value: string,
    ) => dispatch({ type: 'field_changed', field, value }),
    selectCandidate: (ordinal: number) =>
      dispatch({ type: 'candidate_selected', ordinal }),
  };
}

function toUiError(error: unknown): CatalogIntakeUiError {
  return error instanceof CatalogIntakeRequestError
    ? {
        code: error.code,
        message: error.message,
        ...(error.retryable === undefined
          ? {}
          : { retryable: error.retryable }),
      }
    : {
        code: 'unexpected_failure',
        message: 'The Add request could not be completed.',
        retryable: true,
      };
}
