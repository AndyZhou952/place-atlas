'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type SettingsStatus = {
  configured: boolean;
  source: string;
  baseUrl: string;
  model: string;
  canSave: boolean;
};

export function OwnerAgentSettings() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com');
  const [model, setModel] = useState('deepseek-flash');
  const [apiKey, setApiKey] = useState('');

  function apply(result: SettingsStatus) {
    setStatus(result);
    setBaseUrl(result.baseUrl);
    setModel(result.model);
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/owner/agent-settings', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as SettingsStatus & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error ?? 'Could not load settings.');
        apply(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Could not load settings.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, []);

  async function update(method: 'PUT' | 'DELETE') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/owner/agent-settings', {
        method,
        ...(method === 'PUT'
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ baseUrl, model, apiKey }),
            }
          : {}),
      });
      const result = (await response.json()) as SettingsStatus & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? 'Settings could not be saved.');
      apply(result);
      setApiKey('');
      setNotice(
        method === 'PUT'
          ? 'Connection checked and settings saved. The next Add research will use this model. Search results can still depend on source availability.'
          : 'Website override removed. Deployment settings will be used if configured.',
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Settings could not be saved. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="owner-agent-settings">
      <summary>Agent API settings</summary>
      <p>
        Configure the model used by restaurant research. DeepSeek is the tested
        provider; OpenAI-compatible requests to OpenAI are also supported. GLM
        and Claude are not enabled yet.
      </p>
      <p>
        {busy && !status
          ? 'Loading settings…'
          : status?.configured
            ? `Credentials configured (${status.source === 'owner' ? 'website settings' : 'deployment settings'}).`
            : 'No model credentials configured.'}
      </p>
      <form
        className="owner-access-form"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          void update('PUT');
        }}
      >
        <label htmlFor="agent-base-url">API base URL</label>
        <Input
          id="agent-base-url"
          type="url"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          disabled={busy}
          required
          aria-describedby="agent-settings-help"
        />
        <label htmlFor="agent-model">Model identifier</label>
        <Input
          id="agent-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          disabled={busy}
          required
          placeholder="deepseek-flash"
        />
        <label htmlFor="agent-api-key">API key</label>
        <Input
          id="agent-api-key"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          disabled={busy}
          placeholder={
            status?.configured
              ? 'Leave blank to keep the current key'
              : 'Enter your API key'
          }
          aria-describedby="agent-settings-help"
        />
        <p id="agent-settings-help" className="owner-access-help">
          Keys are encrypted on the server, never returned to the page, and are
          not saved in browser storage. A changed base URL requires a new key.
          Use https://api.deepseek.com or https://api.openai.com/v1. Google Maps
          configuration remains a deployment setting.
        </p>
        {error ? (
          <p role="alert" className="owner-access-error">
            {error}
          </p>
        ) : null}
        {notice ? (
          <output aria-live="polite" className="owner-access-success">
            {notice}
          </output>
        ) : null}
        {status && !status.canSave ? (
          <p role="alert">
            Ask the deployment owner to configure a server encryption secret
            before saving keys.
          </p>
        ) : null}
        <div className="owner-access-actions">
          <Button type="submit" disabled={busy || !status?.canSave}>
            {busy ? 'Please wait…' : 'Test & save model settings'}
          </Button>
          {status?.source === 'owner' ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void update('DELETE')}
            >
              Use deployment settings
            </Button>
          ) : null}
        </div>
      </form>
    </details>
  );
}
