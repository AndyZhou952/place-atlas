'use client';

import { useCallback, useReducer } from 'react';

import {
  browserAtlasApplication,
  CatalogIntakeRequestError,
} from './atlas-api-client';
import {
  catalogIntakeInitialState,
  reduceCatalogIntakeUi,
  type CatalogIntakeUiError,
} from './catalog-intake-ui-state';
import type { CatalogIntakeConfirmOutput } from '../../product/application/catalog-intake/catalog-intake-coordinator';

type CommittedCatalogIntakeOutput = Exclude<
  CatalogIntakeConfirmOutput,
  { readonly status: 'conflict' | 'failed_no_write' }
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
      const query = state.query.normalize('NFC').trim();
      if (!query) {
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
    [state.query],
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
    dispatch({ type: 'select_started' });
    try {
      const output = await browserAtlasApplication.execute({
        key: 'catalog.intake.select',
        input: {
          sessionId: state.sessionId,
          expectedSessionVersion: state.sessionVersion,
          ordinal: state.selectedOrdinal,
          ownerFields: compactOwnerFields({
            title: state.title,
            area: state.area,
            address: state.address,
          }),
          tabelog: 'unknown',
          reservation: 'unknown',
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
    if (!state.preview) return;
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
      if (output.status !== 'conflict' && output.status !== 'failed_no_write') {
        onCommitted?.(output);
      }
    } catch (error) {
      dispatch({ type: 'request_failed', error: toUiError(error) });
    }
  }, [onCommitted, state.preview]);

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
    setField: (field: 'query' | 'title' | 'area' | 'address', value: string) =>
      dispatch({ type: 'field_changed', field, value }),
    selectCandidate: (ordinal: number) =>
      dispatch({ type: 'candidate_selected', ordinal }),
  };
}

function compactOwnerFields(fields: {
  readonly title: string;
  readonly area: string;
  readonly address: string;
}) {
  const title = fields.title.normalize('NFC').trim();
  const area = fields.area.normalize('NFC').trim();
  const address = fields.address.normalize('NFC').trim();
  return {
    ...(title ? { title } : {}),
    ...(area ? { area } : {}),
    ...(address ? { address } : {}),
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
