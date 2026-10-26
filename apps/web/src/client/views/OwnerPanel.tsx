import { KeyRound, LogOut } from 'lucide-react';
import { type OwnerViewModel, useModelSettings } from '../viewmodels/useOwner.ts';

export function OwnerPanel({ owner }: { readonly owner: OwnerViewModel }) {
  return (
    <section className="owner-panel card" aria-label="Owner access">
      <h2>{owner.owner ? 'Owner access is active' : 'Owner login'}</h2>
      <p className="muted">
        {owner.owner
          ? 'You can add restaurants, record visits and edit ratings. Visitors can browse but not change anything.'
          : 'Browsing is public. Log in to add restaurants, ratings, visits or photos.'}
      </p>
      {owner.error ? (
        <p className="error" role="alert">
          {owner.error}
        </p>
      ) : null}
      {owner.owner ? (
        <>
          <div className="actions">
            <button
              type="button"
              className="button outline"
              disabled={owner.busy}
              onClick={() => void owner.logout()}
            >
              <LogOut aria-hidden="true" /> Sign out
            </button>
            <button type="button" className="button ghost" onClick={owner.closePanel}>
              Close
            </button>
          </div>
          <ModelSettings />
        </>
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            void owner
              .login(String(new FormData(form).get('password') ?? ''))
              .then((ok) => ok && form.reset());
          }}
        >
          <label>
            Owner password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={owner.busy}
            />
          </label>
          <div className="actions">
            <button type="submit" className="button" disabled={owner.busy}>
              <KeyRound aria-hidden="true" /> {owner.busy ? 'Signing in…' : 'Log in'}
            </button>
            <button type="button" className="button ghost" onClick={owner.closePanel}>
              Close
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ModelSettings() {
  const settings = useModelSettings();
  const { status } = settings;
  return (
    <details className="settings">
      <summary>Model settings</summary>
      <p className="muted">
        The model extracts signature dishes during Add and answers Recommend. Supported endpoints:
        https://api.deepseek.com and https://api.openai.com/v1. Keys are encrypted on the server and
        never sent back to the browser.
      </p>
      <p>
        {status?.configured
          ? `Configured (${status.source === 'owner' ? 'saved here' : 'deployment settings'}).`
          : status
            ? 'No model configured.'
            : 'Loading…'}
      </p>
      <form className="stack" onSubmit={(event) => (event.preventDefault(), void settings.save())}>
        <label>
          API base URL
          <input
            type="url"
            required
            value={settings.form.baseUrl}
            disabled={settings.busy}
            onChange={(event) => settings.setField('baseUrl', event.target.value)}
          />
        </label>
        <label>
          Model
          <input
            required
            value={settings.form.model}
            disabled={settings.busy}
            onChange={(event) => settings.setField('model', event.target.value)}
          />
        </label>
        <label>
          API key
          <input
            type="password"
            autoComplete="new-password"
            value={settings.form.apiKey}
            disabled={settings.busy}
            placeholder={status?.configured ? 'Leave blank to keep the current key' : ''}
            onChange={(event) => settings.setField('apiKey', event.target.value)}
          />
        </label>
        {settings.message ? (
          <output className={settings.message.error ? 'error' : 'success'}>
            {settings.message.text}
          </output>
        ) : null}
        {status && !status.canSave ? (
          <p className="error">
            Set AGENT_SETTINGS_SECRET (32+ characters) on the server to save keys.
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" className="button" disabled={settings.busy || !status?.canSave}>
            {settings.busy ? 'Please wait…' : 'Test and save'}
          </button>
          {status?.source === 'owner' ? (
            <button
              type="button"
              className="button outline"
              disabled={settings.busy}
              onClick={() => void settings.remove()}
            >
              Use deployment settings
            </button>
          ) : null}
        </div>
      </form>
    </details>
  );
}
