import type {
  AddErrorCode,
  CatalogIntakeCancelInput,
  CatalogIntakeCancelOutput,
  CatalogIntakeConfirmInput,
  CatalogIntakeConfirmOutput,
  CatalogIntakeDiscoverInput,
  CatalogIntakeDiscoverOutput,
  CatalogIntakeSelectInput,
  CatalogIntakeSelectOutput,
} from '../shared/catalog-intake.ts';
import type {
  RecommendConversationInput,
  RecommendConversationOutput,
} from '../shared/recommend-conversation.ts';
import type {
  GoogleRating,
  Media,
  ModelSettingsStatus,
  Restaurant,
  RestaurantPatch,
  Visit,
  VisitInput,
} from '../shared/types.ts';

// Model layer: the only module that talks HTTP. View-models call these functions.

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and retry.');
  }
  const payload = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('atlas:login-required'));
    throw new ApiError(
      response.status,
      payload?.error ?? `Request failed (HTTP ${response.status}).`,
    );
  }
  return payload as T;
}

export const api = {
  session: () => request<{ owner: boolean }>('GET', '/api/session'),
  login: (password: string) => request<{ owner: boolean }>('POST', '/api/session', { password }),
  logout: () => request<{ owner: boolean }>('DELETE', '/api/session'),

  restaurants: () => request<Restaurant[]>('GET', '/api/restaurants'),
  updateRestaurant: (id: string, patch: RestaurantPatch) =>
    request<Restaurant>('PATCH', `/api/restaurants/${encodeURIComponent(id)}`, patch),
  deleteRestaurant: (id: string) =>
    request<unknown>('DELETE', `/api/restaurants/${encodeURIComponent(id)}`),

  visits: () => request<Visit[]>('GET', '/api/visits'),
  createVisit: (id: string, input: VisitInput) =>
    request<{ id: string }>('POST', '/api/visits', { id, ...input }),
  updateVisit: (id: string, input: VisitInput) =>
    request<unknown>('PATCH', `/api/visits/${encodeURIComponent(id)}`, input),
  deleteVisit: (id: string) => request<unknown>('DELETE', `/api/visits/${encodeURIComponent(id)}`),
  uploadMedia: (visitId: string, files: readonly File[], ids: readonly string[]) => {
    const form = new FormData();
    files.forEach((file, index) => {
      form.append('files', file);
      form.append('ids', ids[index]);
    });
    return request<Media[]>('POST', `/api/visits/${encodeURIComponent(visitId)}/media`, form);
  },
  updateCaption: (id: string, caption: string) =>
    request<unknown>('PATCH', `/api/media/${encodeURIComponent(id)}`, { caption }),
  deleteMedia: (id: string) => request<unknown>('DELETE', `/api/media/${encodeURIComponent(id)}`),

  googleRatings: () => request<Record<string, GoogleRating>>('GET', '/api/google-ratings'),
  refreshGoogleRating: (id: string) =>
    request<GoogleRating>('POST', `/api/restaurants/${encodeURIComponent(id)}/google-rating`),

  modelSettings: () => request<ModelSettingsStatus>('GET', '/api/settings/model'),
  saveModelSettings: (input: { baseUrl: string; model: string; apiKey: string }) =>
    request<ModelSettingsStatus>('PUT', '/api/settings/model', input),
  removeModelSettings: () => request<ModelSettingsStatus>('DELETE', '/api/settings/model'),

  recommend: (input: RecommendConversationInput) =>
    request<RecommendConversationOutput>('POST', '/api/recommend', input),

  /** The live Google rating for an Add preview; undefined when unavailable. */
  previewGoogleRating: async (sessionId: string, signal: AbortSignal) => {
    const response = await fetch(
      `/api/catalog-intake/google-rating?sessionId=${encodeURIComponent(sessionId)}`,
      { credentials: 'same-origin', cache: 'no-store', signal },
    );
    if (!response.ok || response.status === 204) return undefined;
    const rating = (await response.json()) as Partial<GoogleRating>;
    return typeof rating.score === 'number' && typeof rating.url === 'string'
      ? (rating as GoogleRating)
      : undefined;
  },
};

// Add (catalog intake). Each step after discover echoes the conversation the server returned.

export class AddRequestError extends Error {
  readonly code: AddErrorCode;
  readonly retryable?: boolean;
  readonly reference?: string;
  constructor(code: AddErrorCode, message: string, retryable?: boolean, reference?: string) {
    super(message);
    this.code = code;
    if (retryable !== undefined) this.retryable = retryable;
    if (reference) this.reference = reference;
  }
}

const CONVERSATION_HEADER = 'x-atlas-web-conversation-id';
const CONVERSATION_KEY = 'atlas.catalog-intake.conversation-v1';
const STATUS_CODES: Record<number, AddErrorCode> = {
  400: 'invalid_input',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  410: 'expired',
  413: 'invalid_input',
  429: 'rate_limited',
  503: 'dependency_failure',
};

function storedConversation(): string | undefined {
  try {
    const value = sessionStorage.getItem(CONVERSATION_KEY) ?? undefined;
    return value && /^[a-f0-9]{32}$/u.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function intake<T>(operation: string, input: unknown): Promise<T> {
  const headers = new Headers({ 'content-type': 'application/json' });
  const conversation = storedConversation();
  if (conversation) headers.set(CONVERSATION_HEADER, conversation);
  let response: Response;
  try {
    response = await fetch(`/api/catalog-intake/${operation}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: JSON.stringify({ input }),
    });
  } catch {
    throw new AddRequestError(
      'dependency_failure',
      'We could not reach the Add service. Check your connection, then retry.',
      true,
    );
  }
  const returned = response.headers.get(CONVERSATION_HEADER);
  if (returned && /^[a-f0-9]{32}$/u.test(returned)) {
    try {
      sessionStorage.setItem(CONVERSATION_KEY, returned);
    } catch {
      // Blocked storage only means the next step starts a new conversation.
    }
  }
  const payload = (await response.json().catch(() => undefined)) as
    | { code?: AddErrorCode; message?: string; error?: string; retryable?: boolean }
    | undefined;
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('atlas:login-required'));
    throw new AddRequestError(
      payload?.code ?? STATUS_CODES[response.status] ?? 'unexpected_failure',
      payload?.message ?? payload?.error ?? 'The Add request failed. Nothing was saved.',
      payload?.retryable,
      response.headers.get('x-atlas-request-id') ?? undefined,
    );
  }
  if (!payload)
    throw new AddRequestError(
      'unexpected_failure',
      'The Add service returned an unreadable response. Please retry.',
      true,
    );
  return payload as T;
}

export const addApi = {
  discover: (input: CatalogIntakeDiscoverInput) =>
    intake<CatalogIntakeDiscoverOutput>('discover', input),
  select: (input: CatalogIntakeSelectInput) => intake<CatalogIntakeSelectOutput>('select', input),
  confirm: (input: CatalogIntakeConfirmInput) =>
    intake<CatalogIntakeConfirmOutput>('confirm', input),
  cancel: (input: CatalogIntakeCancelInput) => intake<CatalogIntakeCancelOutput>('cancel', input),
};
