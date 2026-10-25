import type {
  AddCandidate,
  AddDraft,
  AddPreview,
  GoogleRating,
  Media,
  ModelSettingsStatus,
  RecommendResult,
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

  addSearch: (query: string, area: string) =>
    request<AddCandidate[]>('POST', '/api/add/search', { query, area }),
  addPreview: (candidate: Pick<AddCandidate, 'source' | 'ref'>) =>
    request<AddPreview>('POST', '/api/add/preview', {
      source: candidate.source,
      ref: candidate.ref,
    }),
  addSave: (draft: AddDraft) => request<{ id: string }>('POST', '/api/add/save', { draft }),

  recommend: (query: string) => request<RecommendResult>('POST', '/api/recommend', { query }),
};
