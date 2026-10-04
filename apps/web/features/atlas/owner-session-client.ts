export interface OwnerSessionTransport {
  request(url: string, init?: RequestInit): Promise<Response>;
}

export interface OwnerSessionStatus {
  readonly authenticated: boolean;
}

export interface OwnerSessionClient {
  status(): Promise<OwnerSessionStatus>;
  login(password: string): Promise<OwnerSessionStatus>;
  logout(): Promise<void>;
}

type OwnerLoginRequiredListener = () => void;
type OwnerSessionAction = 'status' | 'login' | 'logout';

const ownerLoginRequiredListeners = new Set<OwnerLoginRequiredListener>();
const ownerAuthPath = '/api/auth/owner';

const fetchOwnerSessionTransport: OwnerSessionTransport = {
  request: (url, init) => fetch(url, init),
};

export function createOwnerSessionClient(
  transport: OwnerSessionTransport = fetchOwnerSessionTransport,
): OwnerSessionClient {
  return {
    status: () =>
      requestOwnerStatus(
        transport,
        {
          credentials: 'same-origin',
        },
        'status',
      ),
    login: (password) =>
      requestOwnerStatus(
        transport,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        },
        'login',
      ),
    async logout() {
      const response = await transport.request(ownerAuthPath, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!response.ok) throw ownerSessionError(response.status, 'logout');
    },
  };
}

export function subscribeOwnerLoginRequired(
  listener: OwnerLoginRequiredListener,
): () => void {
  ownerLoginRequiredListeners.add(listener);
  return () => ownerLoginRequiredListeners.delete(listener);
}

export function publishOwnerLoginRequired(): void {
  for (const listener of ownerLoginRequiredListeners) listener();
}

export const ownerSessionClient = createOwnerSessionClient();

async function requestOwnerStatus(
  transport: OwnerSessionTransport,
  init: RequestInit,
  action: OwnerSessionAction,
): Promise<OwnerSessionStatus> {
  const response = await transport.request(ownerAuthPath, init);
  if (!response.ok) throw ownerSessionError(response.status, action);
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { authenticated?: unknown }).authenticated !== 'boolean'
  ) {
    throw new Error('Owner session returned an invalid response.');
  }
  return {
    authenticated: (value as { authenticated: boolean }).authenticated,
  };
}

function ownerSessionError(status: number, action: OwnerSessionAction): Error {
  if (action === 'login' && status === 401) {
    return new Error('The Owner password was not accepted.');
  }
  if (action === 'login' && status === 429) {
    return new Error('Too many login attempts. Wait a moment and try again.');
  }
  if (status === 503) {
    return new Error('Owner access is temporarily unavailable.');
  }
  if (action === 'status') {
    return new Error('Owner status could not be checked.');
  }
  if (action === 'logout') {
    return new Error('Owner logout could not be completed.');
  }
  return new Error('Owner login could not be completed.');
}
