import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOwnerSessionRequestGate,
  createOwnerSessionState,
  reduceOwnerSessionState,
} from './owner-session-state.ts';

void test('Owner session status moves from checking to public browsing or active access', () => {
  const initial = createOwnerSessionState();
  assert.equal(initial.pending, 'status');

  const anonymous = reduceOwnerSessionState(initial, {
    type: 'status.received',
    authenticated: false,
  });
  assert.deepEqual(
    {
      authenticated: anonymous.authenticated,
      expanded: anonymous.expanded,
      pending: anonymous.pending,
    },
    { authenticated: false, expanded: false, pending: null },
  );

  const authenticated = reduceOwnerSessionState(initial, {
    type: 'status.received',
    authenticated: true,
  });
  assert.equal(authenticated.authenticated, true);
});

void test('an unauthorized write opens Owner login and requests password focus', () => {
  const anonymous = reduceOwnerSessionState(createOwnerSessionState(), {
    type: 'status.received',
    authenticated: false,
  });
  const requested = reduceOwnerSessionState(anonymous, {
    type: 'login.required',
  });

  assert.equal(requested.expanded, true);
  assert.equal(requested.focusTarget, 'password');
  assert.match(requested.error ?? '', /log in/i);
});

void test('login covers loading, inline error, visible-password, and success states without navigation', () => {
  let state = reduceOwnerSessionState(createOwnerSessionState(), {
    type: 'status.received',
    authenticated: false,
  });
  state = reduceOwnerSessionState(state, { type: 'panel.toggled' });
  assert.equal(state.expanded, true);

  state = reduceOwnerSessionState(state, { type: 'password.toggled' });
  assert.equal(state.passwordVisible, true);

  state = reduceOwnerSessionState(state, {
    type: 'login.started',
    requestId: 'login-failed',
  });
  assert.equal(state.pending, 'login');

  state = reduceOwnerSessionState(state, {
    type: 'login.failed',
    requestId: 'login-failed',
    message: 'Invalid owner credentials.',
  });
  assert.equal(state.focusTarget, 'error');
  assert.equal(state.error, 'Invalid owner credentials.');

  state = reduceOwnerSessionState(state, {
    type: 'login.started',
    requestId: 'login-success',
  });
  state = reduceOwnerSessionState(state, {
    type: 'login.succeeded',
    requestId: 'login-success',
  });
  assert.equal(state.authenticated, true);
  assert.equal(state.expanded, true);
  assert.equal(state.focusTarget, 'trigger');
  assert.match(state.success ?? '', /active/i);
});

void test('closing with the header trigger clears password visibility and stale errors before reopening', () => {
  let state = reduceOwnerSessionState(createOwnerSessionState(), {
    type: 'status.received',
    authenticated: false,
  });
  state = reduceOwnerSessionState(state, { type: 'panel.toggled' });
  state = reduceOwnerSessionState(state, { type: 'password.toggled' });
  state = reduceOwnerSessionState(state, {
    type: 'login.input_invalid',
    message: 'The Owner password was not accepted.',
  });

  state = reduceOwnerSessionState(state, { type: 'panel.toggled' });
  assert.equal(state.expanded, false);
  assert.equal(state.passwordVisible, false);
  assert.equal(state.error, undefined);
  assert.equal(state.success, undefined);

  state = reduceOwnerSessionState(state, { type: 'panel.toggled' });
  assert.equal(state.expanded, true);
  assert.equal(state.passwordVisible, false);
  assert.equal(state.error, undefined);
  assert.equal(state.focusTarget, 'password');
});

void test('logout has an observable loading state and returns to public browsing', () => {
  let state = reduceOwnerSessionState(createOwnerSessionState(), {
    type: 'status.received',
    authenticated: true,
  });
  state = reduceOwnerSessionState(state, { type: 'panel.toggled' });
  state = reduceOwnerSessionState(state, {
    type: 'logout.started',
    requestId: 'logout-1',
  });
  assert.equal(state.pending, 'logout');

  state = reduceOwnerSessionState(state, {
    type: 'logout.succeeded',
    requestId: 'logout-1',
  });
  assert.deepEqual(
    {
      authenticated: state.authenticated,
      expanded: state.expanded,
      pending: state.pending,
    },
    { authenticated: false, expanded: false, pending: null },
  );
});

void test('a late initial status response cannot overwrite a completed login', () => {
  let state = reduceOwnerSessionState(createOwnerSessionState(), {
    type: 'login.required',
  });
  state = reduceOwnerSessionState(state, {
    type: 'login.started',
    requestId: 'login-before-status',
  });
  state = reduceOwnerSessionState(state, {
    type: 'login.succeeded',
    requestId: 'login-before-status',
  });
  state = reduceOwnerSessionState(state, {
    type: 'status.received',
    authenticated: false,
  });

  assert.equal(state.authenticated, true);
  assert.match(state.success ?? '', /active/i);
});

void test('close attempts and repeated submissions cannot interrupt an active login', () => {
  let state = reduceOwnerSessionState(createOwnerSessionState(), {
    type: 'status.received',
    authenticated: false,
  });
  state = reduceOwnerSessionState(state, { type: 'panel.toggled' });
  state = reduceOwnerSessionState(state, {
    type: 'login.started',
    requestId: 'login-1',
  });

  const closeAttempt = reduceOwnerSessionState(state, {
    type: 'panel.closed',
  });
  const repeatedSubmit = reduceOwnerSessionState(state, {
    type: 'login.started',
    requestId: 'login-2',
  });

  assert.equal(closeAttempt, state);
  assert.equal(repeatedSubmit, state);
  assert.equal(state.expanded, true);
  assert.equal(state.pending, 'login');
  assert.equal(state.activeRequestId, 'login-1');
});

void test('a late request resolution cannot overwrite the active request state', () => {
  let state = reduceOwnerSessionState(createOwnerSessionState(), {
    type: 'status.received',
    authenticated: false,
  });
  state = reduceOwnerSessionState(state, { type: 'panel.toggled' });
  state = reduceOwnerSessionState(state, {
    type: 'login.started',
    requestId: 'login-current',
  });

  const afterLateSuccess = reduceOwnerSessionState(state, {
    type: 'login.succeeded',
    requestId: 'login-expired',
  });
  const afterLateFailure = reduceOwnerSessionState(afterLateSuccess, {
    type: 'login.failed',
    requestId: 'login-expired',
    message: 'Stale failure',
  });

  assert.equal(afterLateSuccess, state);
  assert.equal(afterLateFailure, state);
  assert.equal(afterLateFailure.pending, 'login');
  assert.equal(afterLateFailure.error, undefined);
});

void test('the request gate rejects duplicate submit attempts until the active request finishes', () => {
  const gate = createOwnerSessionRequestGate();
  const current = gate.begin('login');

  assert.match(current ?? '', /^login-/u);
  assert.equal(gate.begin('login'), undefined);
  assert.equal(gate.begin('logout'), undefined);
  assert.equal(gate.finish('expired-request'), false);
  assert.equal(gate.isCurrent(current ?? ''), true);
  assert.equal(gate.finish(current ?? ''), true);

  const next = gate.begin('login');
  assert.notEqual(next, current);
});
