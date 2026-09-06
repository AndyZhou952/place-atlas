import { getD1 } from '@/db';
import type {
  AtlasItem,
  AtlasItemEdit,
  ImportJob,
  NewImportJob,
  NewVisit,
  PersonalState,
  PlaceAssessment,
  PlaceAssessmentPatch,
  VisitCreateResult,
  VisitRecord,
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

interface PlaceAssessmentRow {
  item_id: string;
  overall_rating: number | null;
  is_favorite: number;
  has_visited: number;
  summary: string | null;
  updated_at: string;
}

interface TombstoneRow {
  item_id: string;
}

interface VisitCountRow {
  item_id: string;
  visit_count: number;
}

interface VisitRow {
  id: string;
  item_id: string;
  item_title: string;
  visited_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
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
  const [itemRows, overrideRows, assessmentRows, tombstoneRows, visitCounts] =
    await Promise.all([
      allOrEmpty<ItemRow>(
        db.prepare(
          'SELECT id, payload_json FROM atlas_items ORDER BY created_at DESC',
        ),
      ),
      allOrEmpty<OverrideRow>(
        db.prepare(
          'SELECT item_id, title, description, personal_state, updated_at FROM atlas_item_overrides',
        ),
      ),
      allOrEmpty<PlaceAssessmentRow>(
        db.prepare(
          `SELECT item_id, overall_rating, is_favorite, has_visited,
                  summary, updated_at
           FROM place_assessments`,
        ),
      ),
      allOrEmpty<TombstoneRow>(
        db.prepare('SELECT item_id FROM atlas_item_tombstones'),
      ),
      allOrEmpty<VisitCountRow>(
        db.prepare(
          'SELECT item_id, COUNT(*) AS visit_count FROM visits GROUP BY item_id',
        ),
      ),
    ]);

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

  for (const row of tombstoneRows) byId.delete(row.item_id);

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

  const countsByItem = new Map(
    visitCounts.map((row) => [row.item_id, row.visit_count]),
  );
  for (const [id, item] of byId) {
    const assessment = assessmentRows.find((row) => row.item_id === id);
    byId.set(id, {
      ...item,
      personalRating: assessment?.overall_rating ?? undefined,
      isFavorite: Boolean(assessment?.is_favorite),
      hasVisited:
        Boolean(assessment?.has_visited) || (countsByItem.get(id) ?? 0) > 0,
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

export async function updatePlaceAssessment(
  id: string,
  patch: PlaceAssessmentPatch,
): Promise<AtlasItem> {
  const existingItem = await getAtlasItem(id);
  if (!existingItem) throw new Error('Atlas item not found');

  const current = await getPlaceAssessment(id);
  const next: PlaceAssessment = {
    itemId: id,
    overallRating:
      patch.overallRating === null
        ? undefined
        : (patch.overallRating ?? current?.overallRating),
    isFavorite: patch.isFavorite ?? current?.isFavorite ?? false,
    hasVisited: patch.hasVisited ?? current?.hasVisited ?? false,
    summary:
      patch.summary === null ? undefined : (patch.summary ?? current?.summary),
    updatedAt: new Date().toISOString(),
  };

  await getD1()
    .prepare(
      `INSERT INTO place_assessments
       (item_id, overall_rating, is_favorite, has_visited, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         overall_rating = excluded.overall_rating,
         is_favorite = excluded.is_favorite,
         has_visited = excluded.has_visited,
         summary = excluded.summary,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      next.overallRating ?? null,
      next.isFavorite ? 1 : 0,
      next.hasVisited ? 1 : 0,
      next.summary ?? null,
      next.updatedAt,
      next.updatedAt,
    )
    .run();

  return {
    ...existingItem,
    personalRating: next.overallRating,
    isFavorite: next.isFavorite,
    hasVisited: next.hasVisited,
  };
}

async function getPlaceAssessment(
  itemId: string,
): Promise<PlaceAssessment | undefined> {
  const row = await getD1()
    .prepare(
      `SELECT item_id, overall_rating, is_favorite, has_visited,
              summary, updated_at
       FROM place_assessments WHERE item_id = ?`,
    )
    .bind(itemId)
    .first<PlaceAssessmentRow>();
  if (!row) return undefined;
  return {
    itemId: row.item_id,
    overallRating: row.overall_rating ?? undefined,
    isFavorite: Boolean(row.is_favorite),
    hasVisited: Boolean(row.has_visited),
    summary: row.summary ?? undefined,
    updatedAt: row.updated_at,
  };
}

export async function deleteAtlasItem(id: string): Promise<boolean> {
  const existing = await getAtlasItem(id);
  if (!existing) return false;
  const db = getD1();
  const deletedAt = new Date().toISOString();
  await db.batch([
    db.prepare('DELETE FROM visits WHERE item_id = ?').bind(id),
    db.prepare('DELETE FROM journal_entries WHERE item_id = ?').bind(id),
    db.prepare('DELETE FROM place_assessments WHERE item_id = ?').bind(id),
    db.prepare('DELETE FROM atlas_item_overrides WHERE item_id = ?').bind(id),
    db.prepare('DELETE FROM atlas_items WHERE id = ?').bind(id),
    db
      .prepare(
        `INSERT INTO atlas_item_tombstones (item_id, deleted_at)
       VALUES (?, ?)
       ON CONFLICT(item_id) DO UPDATE SET deleted_at = excluded.deleted_at`,
      )
      .bind(id, deletedAt),
  ]);
  return true;
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

export async function listVisits(): Promise<VisitRecord[]> {
  const rows = await allOrEmpty<VisitRow>(
    getD1().prepare(
      `SELECT id, item_id, item_title, visited_at, note, created_at, updated_at
       FROM visits ORDER BY visited_at DESC, created_at DESC`,
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    visitedAt: row.visited_at,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function addVisit(input: NewVisit): Promise<VisitCreateResult> {
  const item = await getAtlasItem(input.itemId);
  if (!item) throw new Error('Atlas item not found');
  const now = new Date().toISOString();
  const visit: VisitRecord = {
    id: crypto.randomUUID(),
    itemId: item.id,
    itemTitle: item.title,
    visitedAt: input.visitedAt,
    note: input.note?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  await getD1()
    .prepare(
      `INSERT INTO visits
       (id, item_id, item_title, visited_at, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      visit.id,
      visit.itemId,
      visit.itemTitle,
      visit.visitedAt,
      visit.note ?? null,
      visit.createdAt,
      visit.updatedAt,
    )
    .run();
  const updatedItem = await updatePlaceAssessment(item.id, {
    hasVisited: true,
    ...(input.rating === undefined ? {} : { overallRating: input.rating }),
  });
  return { visit, item: updatedItem };
}

export async function deleteJournalEntry(id: string): Promise<boolean> {
  const db = getD1();
  const results = await db.batch([
    db.prepare('DELETE FROM visits WHERE id = ?').bind(id),
    db.prepare('DELETE FROM journal_entries WHERE id = ?').bind(id),
  ]);
  return results.some((result) => (result.meta.changes ?? 0) > 0);
}

export async function deleteImportJob(id: string): Promise<boolean> {
  const result = await getD1()
    .prepare('DELETE FROM import_jobs WHERE id = ?')
    .bind(id)
    .run();
  return (result.meta.changes ?? 0) > 0;
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
