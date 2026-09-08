import type {
  AtlasItem,
  AtlasItemEdit,
  ImportJob,
  NewImportJob,
  NewVisit,
  PlaceAssessmentPatch,
  VisitCreateResult,
  VisitMediaRecord,
  VisitMutationResult,
  VisitRecord,
  VisitUpdate,
} from './model';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export function fetchAtlasItems(): Promise<AtlasItem[]> {
  return requestJson('/api/items');
}

export function updateAtlasItem(
  id: string,
  edit: AtlasItemEdit,
): Promise<AtlasItem> {
  return requestJson(`/api/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(edit),
  });
}

export function updateItemAssessment(
  id: string,
  patch: PlaceAssessmentPatch,
): Promise<AtlasItem> {
  return requestJson(`/api/items/${encodeURIComponent(id)}/personal`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteAtlasItem(id: string): Promise<{ deleted: true }> {
  return requestJson(`/api/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function fetchImportJobs(): Promise<ImportJob[]> {
  return requestJson('/api/inbox');
}

export function createImportJob(input: NewImportJob): Promise<ImportJob> {
  return requestJson('/api/inbox', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchVisits(): Promise<VisitRecord[]> {
  return requestJson('/api/journal');
}

export function createVisit(input: NewVisit): Promise<VisitCreateResult> {
  return requestJson('/api/journal', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateVisit(
  id: string,
  input: VisitUpdate,
): Promise<VisitMutationResult> {
  return requestJson(`/api/journal/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteVisit(id: string): Promise<VisitMutationResult> {
  return requestJson(`/api/journal/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function fetchVisitMedia(): Promise<VisitMediaRecord[]> {
  return requestJson('/api/media');
}

export function uploadVisitMedia(
  visitId: string,
  files: readonly File[],
): Promise<VisitMediaRecord[]> {
  const body = new FormData();
  body.set('visitId', visitId);
  for (const file of files) body.append('files', file);
  return requestJson('/api/media', { method: 'POST', body });
}

export function updateVisitMediaCaption(
  id: string,
  caption?: string,
): Promise<VisitMediaRecord> {
  return requestJson(`/api/media/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ caption: caption || null }),
  });
}

export function deleteVisitMedia(id: string): Promise<{ deleted: true }> {
  return requestJson(`/api/media/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
