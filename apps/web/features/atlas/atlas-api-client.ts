import type {
  AtlasItem,
  AtlasItemEdit,
  ImportJob,
  JournalEntry,
  NewImportJob,
  NewJournalEntry,
} from './model';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
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

export function fetchImportJobs(): Promise<ImportJob[]> {
  return requestJson('/api/inbox');
}

export function createImportJob(input: NewImportJob): Promise<ImportJob> {
  return requestJson('/api/inbox', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function fetchJournalEntries(): Promise<JournalEntry[]> {
  return requestJson('/api/journal');
}

export function createJournalEntry(
  input: NewJournalEntry,
): Promise<JournalEntry> {
  return requestJson('/api/journal', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
