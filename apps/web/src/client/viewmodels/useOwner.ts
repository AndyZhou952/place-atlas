import { useCallback, useEffect, useState } from 'react';
import type { ModelSettingsStatus } from '../../shared/types.ts';
import { api } from '../api.ts';

/** Owner session: status, login/logout and the login panel's visibility. */
export function useOwner() {
  const [owner, setOwner] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.session().then(
      ({ owner }) => setOwner(owner),
      () => undefined,
    );
    // An expired session surfaces as a 401; reopen the login panel.
    const expired = () => {
      setOwner(false);
      setPanelOpen(true);
      setError('Your Owner session has expired. Log in again.');
    };
    window.addEventListener('atlas:login-required', expired);
    return () => window.removeEventListener('atlas:login-required', expired);
  }, []);

  const act = useCallback(async (action: () => Promise<{ owner: boolean }>) => {
    setBusy(true);
    setError('');
    try {
      setOwner((await action()).owner);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Login failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    owner,
    panelOpen,
    busy,
    error,
    togglePanel: () => setPanelOpen((open) => !open),
    closePanel: () => setPanelOpen(false),
    login: (password: string) => act(() => api.login(password)),
    logout: () => act(api.logout),
  };
}

export type OwnerViewModel = ReturnType<typeof useOwner>;

/** Owner-saved model credentials (encrypted on the server, never returned). */
export function useModelSettings() {
  const [status, setStatus] = useState<ModelSettingsStatus>();
  const [form, setForm] = useState({
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: '',
  });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<{ error: boolean; text: string }>();

  const apply = (next: ModelSettingsStatus) => {
    setStatus(next);
    setForm({ baseUrl: next.baseUrl, model: next.model, apiKey: '' });
  };
  useEffect(() => {
    api
      .modelSettings()
      .then(apply, (error) => setMessage({ error: true, text: error.message }))
      .finally(() => setBusy(false));
  }, []);

  const update = async (action: () => Promise<ModelSettingsStatus>, success: string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      apply(await action());
      setMessage({ error: false, text: success });
    } catch (error) {
      setMessage({
        error: true,
        text: error instanceof Error ? error.message : 'Settings could not be saved.',
      });
    } finally {
      setBusy(false);
    }
  };

  return {
    status,
    form,
    busy,
    message,
    setField: (field: keyof typeof form, value: string) =>
      setForm((current) => ({ ...current, [field]: value })),
    save: () => update(() => api.saveModelSettings(form), 'Connection checked and settings saved.'),
    remove: () =>
      update(api.removeModelSettings, 'Saved settings removed; deployment settings apply.'),
  };
}
