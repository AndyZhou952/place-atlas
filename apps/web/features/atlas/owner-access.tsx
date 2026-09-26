'use client';

import { useEffect, useRef } from 'react';
import { Eye, EyeOff, KeyRound, LogOut, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { OwnerSessionController } from './use-owner-session';
import { OwnerAgentSettings } from './owner-agent-settings';

const panelId = 'owner-access-panel';
const passwordId = 'owner-password';
const passwordHelpId = 'owner-password-help';
const passwordErrorId = 'owner-password-error';

export function OwnerAccessButton({
  owner,
}: {
  readonly owner: OwnerSessionController;
}) {
  const { state } = owner;
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state.focusTarget === 'trigger') triggerRef.current?.focus();
  }, [state.focusRevision, state.focusTarget]);

  return (
    <Button
      ref={triggerRef}
      className="owner-access-trigger"
      variant="outline"
      type="button"
      aria-controls={panelId}
      aria-expanded={state.expanded}
      aria-busy={state.pending !== null}
      disabled={state.pending !== null}
      onClick={owner.toggle}
    >
      <KeyRound data-icon="inline-start" aria-hidden="true" />
      {state.pending === 'status'
        ? 'Checking…'
        : state.authenticated
          ? 'Owner active'
          : 'Owner login'}
    </Button>
  );
}

export function OwnerAccessPanel({
  owner,
}: {
  readonly owner: OwnerSessionController;
}) {
  const { state } = owner;
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.focusTarget === 'password') passwordRef.current?.focus();
    if (state.focusTarget === 'error') errorRef.current?.focus();
  }, [state.focusRevision, state.focusTarget]);

  if (!state.expanded) return null;

  const loginPending = state.pending === 'login';
  const logoutPending = state.pending === 'logout';

  return (
    <section
      id={panelId}
      className="owner-access-panel"
      aria-labelledby="owner-access-title"
    >
      <div className="owner-access-copy">
        <p className="eyebrow">Write access</p>
        <h2 id="owner-access-title">
          {state.authenticated ? 'Owner access is active' : 'Owner login'}
        </h2>
        <p>
          {state.authenticated
            ? 'Your Atlas controls can save now. Public visitors can still browse but cannot change anything.'
            : 'Browsing stays public. Log in only when you want to save a place, rating, visit, comment, or photo.'}
        </p>
      </div>

      {state.authenticated ? (
        <div className="owner-access-session" aria-busy={logoutPending}>
          <output className="owner-access-success" aria-live="polite">
            {state.success ?? 'Signed in as Owner.'}
          </output>
          {state.error ? (
            <p
              ref={errorRef}
              id={passwordErrorId}
              className="owner-access-error"
              role="alert"
              tabIndex={-1}
            >
              {state.error}
            </p>
          ) : null}
          <div className="owner-access-actions">
            <Button
              type="button"
              variant="outline"
              disabled={logoutPending}
              onClick={() => void owner.logout()}
            >
              <LogOut data-icon="inline-start" aria-hidden="true" />
              {logoutPending ? 'Signing out…' : 'Sign out'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={logoutPending}
              onClick={owner.close}
            >
              Close
            </Button>
          </div>
          <OwnerAgentSettings />
        </div>
      ) : (
        <form
          className="owner-access-form"
          aria-busy={loginPending}
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const password = new FormData(form).get('password');
            void owner
              .login(typeof password === 'string' ? password : '')
              .then((succeeded) => {
                if (succeeded) form.reset();
              });
          }}
        >
          <label htmlFor={passwordId}>Owner password</label>
          <div className="owner-password-row">
            <Input
              ref={passwordRef}
              id={passwordId}
              name="password"
              type={state.passwordVisible ? 'text' : 'password'}
              autoComplete="current-password"
              aria-invalid={Boolean(state.error)}
              aria-describedby={
                state.error
                  ? `${passwordHelpId} ${passwordErrorId}`
                  : passwordHelpId
              }
              disabled={loginPending}
            />
            <Button
              type="button"
              variant="outline"
              aria-controls={passwordId}
              aria-label={
                state.passwordVisible ? 'Hide password' : 'Show password'
              }
              aria-pressed={state.passwordVisible}
              disabled={loginPending}
              onClick={owner.togglePassword}
            >
              {state.passwordVisible ? (
                <EyeOff aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
              <span>{state.passwordVisible ? 'Hide' : 'Show'}</span>
            </Button>
          </div>
          <p id={passwordHelpId} className="owner-access-help">
            The password is sent only to this site and is never stored in the
            page.
          </p>
          {state.error ? (
            <p
              ref={errorRef}
              id={passwordErrorId}
              className="owner-access-error"
              role="alert"
              tabIndex={-1}
            >
              {state.error}
            </p>
          ) : null}
          <div className="owner-access-actions">
            <Button type="submit" disabled={loginPending}>
              <KeyRound data-icon="inline-start" aria-hidden="true" />
              {loginPending ? 'Signing in…' : 'Log in'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={loginPending}
              onClick={owner.close}
            >
              <X data-icon="inline-start" aria-hidden="true" />
              Close
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
