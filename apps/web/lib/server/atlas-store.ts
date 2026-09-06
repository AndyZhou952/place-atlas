import { getD1 } from '@/db';
import type {
  AtlasItem,
  AtlasItemEdit,
  ImportJob,
  JournalEntry,
  NewImportJob,
  NewJournalEntry,
  PersonalState,
} from '@/features/atlas/model';
import { verifiedAtlasItems } from '@/features/atlas/verified-items';

interface ItemRow {
  id: string;
  payload_json: string;
}

interface OverrideRow {
  item_id: string;
  title: string;
  description: string;
  personal_state: PersonalState;
  updated_at: string;
}

interface ImportJobRow {
  id: string;
  source_ref: string;
  creator_name: string;
  platform: string;
  status: ImportJob['status'];
  discovered_count: number;
  needs_review_count: number;
  message: string | null;
  created_at: string;
  updated_at: string;
}

interface JournalEntryRow {
  id: string;
  item_id: string;
  item_title: string;
  visited_at: string;
  rating: number;
  note: string;
  created_at: string;
}

function isMissingTable(error: unknown): boolean {
  return error instanceof Error && error.message.includes('no such table');
}

async function allOrEmpty<T>(statement: D1PreparedStatement): Promise<T[]> {
  try {
    const result = await statement.all<T>();
    return result.results;
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function listAtlasItems(): Promise<AtlasItem[]> {
  const db = getD1();
  const itemRows = await allOrEmpty<ItemRow>(
    db.prepare(
      'SELECT id, payload_json FROM atlas_items ORDER BY created_at DESC',
    ),
  );
  const overrideRows = await allOrEmpty<OverrideRow>(
    db.prepare(
      'SELECT item_id, title, description, personal_state, updated_at FROM atlas_item_overrides',
    ),
  );

  const dynamicItems = itemRows.flatMap((row) => {
    try {
      return [JSON.parse(row.payload_json) as AtlasItem];
    } catch {
      return [];
    }
  });
  const byId = new Map(
    [...verifiedAtlasItems, ...dynamicItems].map((item) => [item.id, item]),
  );

  for (const row of overrideRows) {
    const item = byId.get(row.item_id);
    if (!item) continue;
    byId.set(row.item_id, {
      ...item,
      title: row.title,
      description: row.description,
      personalState: row.personal_state,
      updatedAt: row.updated_at,
    });
  }

  return [...byId.values()];
}

export async function getAtlasItem(id: string): Promise<AtlasItem | undefined> {
  return (await listAtlasItems()).find((item) => item.id === id);
}

export async function saveDiscoveredItem(item: AtlasItem): Promise<AtlasItem> {
  const now = new Date().toISOString();
  const stored = { ...item, updatedAt: now };
  await getD1()
    .prepare(
      `INSERT INTO atlas_items (id, payload_json, verification_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         payload_json = excluded.payload_json,
         verification_status = excluded.verification_status,
         updated_at = excluded.updated_at`,
    )
    .bind(item.id, JSON.stringify(stored), item.verificationStatus, now, now)
    .run();
  return stored;
}

export async function updateAtlasItem(
  id: string,
  edit: AtlasItemEdit,
): Promise<AtlasItem> {
  const existing = await getAtlasItem(id);
  if (!existing) throw new Error('Atlas item not found');

  const now = new Date().toISOString();
  await getD1()
    .prepare(
      `INSERT INTO atlas_item_overrides (item_id, title, description, personal_state, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         personal_state = excluded.personal_state,
         updated_at = excluded.updated_at`,
    )
    .bind(id, edit.title, edit.description, edit.personalState, now)
    .run();

  return { ...existing, ...edit, updatedAt: now };
}

export async function listImportJobs(): Promise<ImportJob[]> {
  const rows = await allOrEmpty<ImportJobRow>(
    getD1().prepare(
      `SELECT id, source_ref, creator_name, platform, status,
              discovered_count, needs_review_count, message, created_at, updated_at
       FROM import_jobs ORDER BY created_at DESC`,
    ),
  );
  return rows.map(toImportJob);
}

export async function queueImportJob(input: NewImportJob): Promise<ImportJob> {
  const now = new Date().toISOString();
  const job: ImportJob = {
    id: crypto.randomUUID(),
    sourceRef: input.sourceRef,
    creatorName: input.creatorName,
    platform: input.platform ?? inferPlatform(input.sourceRef),
    status: 'queued',
    discoveredCount: 0,
    needsReviewCount: 0,
    createdAt: now,
    updatedAt: now,
    message: 'Waiting for the collector worker.',
  };

  await getD1()
    .prepare(
      `INSERT INTO import_jobs
       (id, source_ref, creator_name, platform, status, discovered_count,
        needs_review_count, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      job.id,
      job.sourceRef,
      job.creatorName,
      job.platform,
      job.status,
      job.discoveredCount,
      job.needsReviewCount,
      job.message,
      job.createdAt,
      job.updatedAt,
    )
    .run();
  return job;
}

export async function listJournalEntries(): Promise<JournalEntry[]> {
  const rows = await allOrEmpty<JournalEntryRow>(
    getD1().prepare(
      `SELECT id, item_id, item_title, visited_at, rating, note, created_at
       FROM journal_entries ORDER BY visited_at DESC, created_at DESC`,
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    visitedAt: row.visited_at,
    rating: row.rating,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export async function addJournalEntry(
  input: NewJournalEntry,
): Promise<JournalEntry> {
  const item = await getAtlasItem(input.itemId);
  if (!item) throw new Error('Atlas item not found');
  const entry: JournalEntry = {
    id: crypto.randomUUID(),
    itemId: item.id,
    itemTitle: item.title,
    visitedAt: input.visitedAt,
    rating: input.rating,
    note: input.note,
    createdAt: new Date().toISOString(),
  };

  await getD1()
    .prepare(
      `INSERT INTO journal_entries
       (id, item_id, item_title, visited_at, rating, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.id,
      entry.itemId,
      entry.itemTitle,
      entry.visitedAt,
      entry.rating,
      entry.note,
      entry.createdAt,
    )
    .run();
  return entry;
}

function toImportJob(row: ImportJobRow): ImportJob {
  return {
    id: row.id,
    sourceRef: row.source_ref,
    creatorName: row.creator_name,
    platform: row.platform,
    status: row.status,
    discoveredCount: row.discovered_count,
    needsReviewCount: row.needs_review_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    message: row.message ?? undefined,
  };
}

function inferPlatform(sourceRef: string): string {
  const value = sourceRef.toLocaleLowerCase();
  if (value.includes('xiaohongshu') || value.startsWith('rednote:')) {
    return 'Xiaohongshu';
  }
  if (value.includes('bilibili') || value.startsWith('bilibili:')) {
    return 'Bilibili';
  }
  if (value.includes('youtube')) return 'YouTube';
  if (value.includes('x.com') || value.startsWith('x:')) return 'X';
  return 'Web';
}
