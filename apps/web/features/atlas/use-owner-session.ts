'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';

import {
  ownerSessionClient,
  subscribeOwnerLoginRequired,
} from './owner-session-client';
import {
  createOwnerSessionRequestGate,
  createOwnerSessionState,
  reduceOwnerSessionState,
} from './owner-session-state';

export function useOwnerSession() {
  const [state, dispatch] = useReducer(
    reduceOwnerSessionState,
    undefined,
    createOwnerSessionState,
  );
  const [requestGate] = useState(createOwnerSessionRequestGate);
  useEffect(() => {
    let active = true;
    void ownerSessionClient
      .status()
      .then(({ authenticated }) => {
        if (active) dispatch({ type: 'status.received', authenticated });
      })
      .catch(() => {
        if (active) {
          dispatch({
            type: 'status.failed',
            message:
              'Owner status could not be checked. Public browsing is still available.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      subscribeOwnerLoginRequired(() => {
        dispatch({ type: 'login.required' });
      }),
    [],
  );

  const login = useCallback(
    async (password: string) => {
      const requestId = requestGate.begin('login');
      if (!requestId) return false;
      if (!password) {
        requestGate.finish(requestId);
        dispatch({
          type: 'login.input_invalid',
          message: 'Enter the Owner password.',
        });
        return false;
      }
      dispatch({ type: 'login.started', requestId });
      try {
        await ownerSessionClient.login(password);
        if (!requestGate.isCurrent(requestId)) return false;
        dispatch({ type: 'login.succeeded', requestId });
        return true;
      } catch (error) {
        if (!requestGate.isCurrent(requestId)) return false;
        dispatch({
          type: 'login.failed',
          requestId,
          message:
            error instanceof Error
              ? error.message
              : 'Owner login could not be completed.',
        });
        return false;
      } finally {
        requestGate.finish(requestId);
      }
    },
    [requestGate],
  );

  const logout = useCallback(async () => {
    const requestId = requestGate.begin('logout');
    if (!requestId) return;
    dispatch({ type: 'logout.started', requestId });
    try {
      await ownerSessionClient.logout();
      if (!requestGate.isCurrent(requestId)) return;
      dispatch({ type: 'logout.succeeded', requestId });
    } catch (error) {
      if (!requestGate.isCurrent(requestId)) return;
      dispatch({
        type: 'logout.failed',
        requestId,
        message:
          error instanceof Error
            ? error.message
            : 'Owner logout could not be completed.',
      });
    } finally {
      requestGate.finish(requestId);
    }
  }, [requestGate]);

  return {
    state,
    close: () => dispatch({ type: 'panel.closed' }),
    login,
    logout,
    toggle: () => dispatch({ type: 'panel.toggled' }),
    togglePassword: () => dispatch({ type: 'password.toggled' }),
  } as const;
}

export type OwnerSessionController = ReturnType<typeof useOwnerSession>;
