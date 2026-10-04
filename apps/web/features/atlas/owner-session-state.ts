export type OwnerSessionPending = 'status' | 'login' | 'logout' | null;
export type OwnerSessionFocusTarget = 'password' | 'error' | 'trigger' | null;

export interface OwnerSessionState {
  readonly authenticated: boolean | null;
  readonly expanded: boolean;
  readonly pending: OwnerSessionPending;
  readonly passwordVisible: boolean;
  readonly error?: string;
  readonly success?: string;
  readonly focusTarget: OwnerSessionFocusTarget;
  readonly focusRevision: number;
  readonly activeRequestId?: string;
}

export type OwnerSessionAction =
  | { readonly type: 'status.received'; readonly authenticated: boolean }
  | { readonly type: 'status.failed'; readonly message: string }
  | { readonly type: 'panel.toggled' }
  | { readonly type: 'panel.closed' }
  | { readonly type: 'password.toggled' }
  | { readonly type: 'login.required' }
  | { readonly type: 'login.input_invalid'; readonly message: string }
  | { readonly type: 'login.started'; readonly requestId: string }
  | {
      readonly type: 'login.failed';
      readonly requestId: string;
      readonly message: string;
    }
  | { readonly type: 'login.succeeded'; readonly requestId: string }
  | { readonly type: 'logout.started'; readonly requestId: string }
  | {
      readonly type: 'logout.failed';
      readonly requestId: string;
      readonly message: string;
    }
  | { readonly type: 'logout.succeeded'; readonly requestId: string };

export interface OwnerSessionRequestGate {
  begin(action: 'login' | 'logout'): string | undefined;
  finish(requestId: string): boolean;
  isCurrent(requestId: string): boolean;
}

export function createOwnerSessionState(): OwnerSessionState {
  return {
    authenticated: null,
    expanded: false,
    pending: 'status',
    passwordVisible: false,
    focusTarget: null,
    focusRevision: 0,
  };
}

export function reduceOwnerSessionState(
  state: OwnerSessionState,
  action: OwnerSessionAction,
): OwnerSessionState {
  switch (action.type) {
    case 'status.received':
      if (state.pending !== 'status' || state.authenticated !== null) {
        return state;
      }
      return {
        ...state,
        authenticated: action.authenticated,
        pending: null,
        error: undefined,
      };
    case 'status.failed':
      if (state.pending !== 'status' || state.authenticated !== null) {
        return state;
      }
      return {
        ...state,
        authenticated: false,
        pending: null,
        error: action.message,
      };
    case 'panel.toggled': {
      if (isAuthRequestPending(state)) return state;
      const expanded = !state.expanded;
      if (!expanded) return closePanel(state);
      return focus(
        {
          ...state,
          expanded: true,
          passwordVisible: false,
          error: undefined,
        },
        !state.authenticated ? 'password' : 'trigger',
      );
    }
    case 'panel.closed':
      if (isAuthRequestPending(state)) return state;
      return closePanel(state);
    case 'password.toggled':
      if (isAuthRequestPending(state)) return state;
      return { ...state, passwordVisible: !state.passwordVisible };
    case 'login.required':
      if (isAuthRequestPending(state)) return state;
      return focus(
        {
          ...state,
          authenticated: false,
          expanded: true,
          pending: null,
          success: undefined,
          error: 'Please log in as Owner, then retry the action.',
        },
        'password',
      );
    case 'login.input_invalid':
      if (isAuthRequestPending(state)) return state;
      return focus({ ...state, error: action.message }, 'error');
    case 'login.started':
      if (state.pending !== null) return state;
      return {
        ...state,
        expanded: true,
        pending: 'login',
        error: undefined,
        success: undefined,
        focusTarget: null,
        activeRequestId: action.requestId,
      };
    case 'login.failed':
      if (!isCurrentRequest(state, 'login', action.requestId)) return state;
      return focus(
        {
          ...state,
          pending: null,
          activeRequestId: undefined,
          error: action.message,
        },
        'error',
      );
    case 'login.succeeded':
      if (!isCurrentRequest(state, 'login', action.requestId)) return state;
      return focus(
        {
          ...state,
          authenticated: true,
          expanded: true,
          pending: null,
          passwordVisible: false,
          activeRequestId: undefined,
          error: undefined,
          success: 'Owner access is active. You can retry the action now.',
        },
        'trigger',
      );
    case 'logout.started':
      if (state.pending !== null) return state;
      return {
        ...state,
        pending: 'logout',
        error: undefined,
        success: undefined,
        activeRequestId: action.requestId,
      };
    case 'logout.failed':
      if (!isCurrentRequest(state, 'logout', action.requestId)) return state;
      return focus(
        {
          ...state,
          pending: null,
          activeRequestId: undefined,
          error: action.message,
        },
        'error',
      );
    case 'logout.succeeded':
      if (!isCurrentRequest(state, 'logout', action.requestId)) return state;
      return focus(
        {
          ...state,
          authenticated: false,
          expanded: false,
          pending: null,
          passwordVisible: false,
          activeRequestId: undefined,
          error: undefined,
          success: undefined,
        },
        'trigger',
      );
  }
}

export function createOwnerSessionRequestGate(): OwnerSessionRequestGate {
  let sequence = 0;
  let activeRequestId: string | undefined;
  return {
    begin(action) {
      if (activeRequestId) return undefined;
      sequence += 1;
      activeRequestId = `${action}-${sequence}`;
      return activeRequestId;
    },
    finish(requestId) {
      if (activeRequestId !== requestId) return false;
      activeRequestId = undefined;
      return true;
    },
    isCurrent: (requestId) => activeRequestId === requestId,
  };
}

function isAuthRequestPending(state: OwnerSessionState): boolean {
  return state.pending === 'login' || state.pending === 'logout';
}

function isCurrentRequest(
  state: OwnerSessionState,
  pending: Exclude<OwnerSessionPending, 'status' | null>,
  requestId: string,
): boolean {
  return state.pending === pending && state.activeRequestId === requestId;
}

function closePanel(state: OwnerSessionState): OwnerSessionState {
  return focus(
    {
      ...state,
      expanded: false,
      passwordVisible: false,
      error: undefined,
      success: undefined,
    },
    'trigger',
  );
}

function focus(
  state: OwnerSessionState,
  focusTarget: OwnerSessionFocusTarget,
): OwnerSessionState {
  return {
    ...state,
    focusTarget,
    focusRevision: state.focusRevision + 1,
  };
}
