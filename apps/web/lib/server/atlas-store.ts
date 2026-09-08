import { getD1 } from '@/db';
import type {
  AtlasItem,
  AtlasItemEdit,
  ImportJob,
  NewImportJob,
  NewVisit,
  PersonalState,
  PlaceAssessmentPatch,
  VisitCreateResult,
  VisitMutationResult,
  VisitRecord,
  VisitUpdate,
} from '@/features/atlas/model';
import { normalizeRating } from '@/features/atlas/rating';
import { verifiedAtlasItems } from '@/features/atlas/verified-items';

import {
  deleteLegacyJournalEntrySql,
  deleteVisitSql,
  insertVisitSql,
  reconcileVisitedAfterDeleteSql,
  updateVisitSql,
  upsertVisitRatingSql,
  upsertVisitedWithRatingSql,
  upsertVisitedWithoutRatingSql,
} from './journal-write';

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

interface ResolvedItemRow {
  payload_json: string | null;
  override_title: string | null;
  override_description: string | null;
  override_personal_state: PersonalState | null;
  override_updated_at: string | null;
  overall_rating: number | null;
  is_favorite: number | null;
  has_visited: number | null;
  has_visit: number;
  tombstone_id: string | null;
}

interface ResolvedVisitMutationRow extends ResolvedItemRow {
  visit_id: string;
  visit_item_id: string;
  visit_item_title: string;
  visit_visited_at: string;
  visit_note: string | null;
  visit_created_at: string;
  visit_updated_at: string;
  visit_count: number;
}

const verifiedItemsById = new Map(
  verifiedAtlasItems.map((item) => [item.id, item]),
);

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
  const assessmentsByItem = new Map(
    assessmentRows.map((row) => [row.item_id, row]),
  );
  for (const [id, item] of byId) {
    const assessment = assessmentsByItem.get(id);
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
  const row = await getD1()
    .prepare(
      `SELECT items.payload_json,
              overrides.title AS override_title,
              overrides.description AS override_description,
              overrides.personal_state AS override_personal_state,
              overrides.updated_at AS override_updated_at,
              assessments.overall_rating,
              assessments.is_favorite,
              assessments.has_visited,
              CASE WHEN EXISTS (
                SELECT 1 FROM visits
                WHERE visits.item_id = requested.item_id
                LIMIT 1
              ) THEN 1 ELSE 0 END AS has_visit,
              tombstones.item_id AS tombstone_id
       FROM (SELECT ? AS item_id) AS requested
       LEFT JOIN atlas_items AS items ON items.id = requested.item_id
       LEFT JOIN atlas_item_overrides AS overrides
         ON overrides.item_id = requested.item_id
       LEFT JOIN place_assessments AS assessments
         ON assessments.item_id = requested.item_id
       LEFT JOIN atlas_item_tombstones AS tombstones
         ON tombstones.item_id = requested.item_id`,
    )
    .bind(id)
    .first<ResolvedItemRow>();
  return row ? resolveAtlasItem(id, row) : undefined;
}

function resolveAtlasItem(
  id: string,
  row: ResolvedItemRow,
): AtlasItem | undefined {
  if (row.tombstone_id) return undefined;

  let item = verifiedItemsById.get(id);
  if (!item && row.payload_json) {
    try {
      item = JSON.parse(row.payload_json) as AtlasItem;
    } catch {
      return undefined;
    }
  }
  if (!item) return undefined;

  return {
    ...item,
    ...(row.override_title === null
      ? {}
      : {
          title: row.override_title,
          description: row.override_description ?? item.description,
          personalState: row.override_personal_state ?? item.personalState,
          updatedAt: row.override_updated_at ?? item.updatedAt,
        }),
    personalRating: row.overall_rating ?? undefined,
    isFavorite: Boolean(row.is_favorite),
    hasVisited: Boolean(row.has_visited) || Boolean(row.has_visit),
  };
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

  const overallRating =
    patch.overallRating === null
      ? undefined
      : patch.overallRating === undefined
        ? existingItem.personalRating
        : normalizeRating(patch.overallRating);
  const isFavorite = patch.isFavorite ?? existingItem.isFavorite ?? false;
  const hasVisited = patch.hasVisited ?? existingItem.hasVisited ?? false;
  const summaryProvided = patch.summary !== undefined;
  const summary = patch.summary?.trim() || null;
  const updatedAt = new Date().toISOString();

  await getD1()
    .prepare(
      `INSERT INTO place_assessments
       (item_id, overall_rating, is_favorite, has_visited, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         overall_rating = excluded.overall_rating,
         is_favorite = excluded.is_favorite,
         has_visited = excluded.has_visited,
         summary = CASE WHEN ? = 1 THEN excluded.summary ELSE place_assessments.summary END,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      overallRating ?? null,
      isFavorite ? 1 : 0,
      hasVisited ? 1 : 0,
      summary,
      updatedAt,
      updatedAt,
      summaryProvided ? 1 : 0,
    )
    .run();

  return {
    ...existingItem,
    personalRating: overallRating,
    isFavorite,
    hasVisited,
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
    id: input.id ?? crypto.randomUUID(),
    itemId: item.id,
    itemTitle: item.title,
    visitedAt: input.visitedAt,
    note: input.note?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  const db = getD1();
  const assessmentStatement =
    input.rating === undefined
      ? db.prepare(upsertVisitedWithoutRatingSql).bind(item.id, now, now)
      : db
          .prepare(upsertVisitedWithRatingSql)
          .bind(item.id, normalizeRating(input.rating), now, now);

  await db.batch([
    db
      .prepare(insertVisitSql)
      .bind(
        visit.id,
        visit.itemId,
        visit.itemTitle,
        visit.visitedAt,
        visit.note ?? null,
        visit.createdAt,
        visit.updatedAt,
      ),
    assessmentStatement,
  ]);
  const updatedItem: AtlasItem = {
    ...item,
    hasVisited: true,
    ...(input.rating === undefined
      ? {}
      : { personalRating: normalizeRating(input.rating) }),
  };
  return { visit, item: updatedItem };
}

export async function updateVisit(
  id: string,
  input: VisitUpdate,
): Promise<VisitMutationResult | undefined> {
  const context = await getVisitMutationContext(id);
  if (!context) return undefined;
  const { item, visit: existing } = context;

  const updatedAt = new Date().toISOString();
  const visit: VisitRecord = {
    ...existing,
    visitedAt: input.visitedAt,
    note: input.note?.trim() || undefined,
    updatedAt,
  };

  const db = getD1();
  const visitUpdate = db
    .prepare(updateVisitSql)
    .bind(visit.visitedAt, visit.note ?? null, updatedAt, id);
  if (input.rating === undefined) {
    await visitUpdate.run();
    return { visit, item };
  }

  const overallRating =
    input.rating === null ? undefined : normalizeRating(input.rating);
  const assessmentUpdate = db
    .prepare(upsertVisitRatingSql)
    .bind(
      item.id,
      overallRating ?? null,
      item.isFavorite ? 1 : 0,
      item.hasVisited ? 1 : 0,
      updatedAt,
      updatedAt,
    );
  await db.batch([visitUpdate, assessmentUpdate]);

  const updatedItem = { ...item, personalRating: overallRating };
  return { visit, item: updatedItem };
}

export async function deleteJournalEntry(
  id: string,
): Promise<VisitMutationResult | undefined> {
  const context = await getVisitMutationContext(id);
  if (!context) return undefined;
  const { item, visit: existing, visitCount } = context;

  const db = getD1();
  const updatedAt = new Date().toISOString();
  await db.batch([
    db.prepare(deleteVisitSql).bind(id),
    db.prepare(deleteLegacyJournalEntrySql).bind(id),
    db
      .prepare(reconcileVisitedAfterDeleteSql)
      .bind(existing.itemId, existing.itemId, updatedAt, updatedAt),
  ]);
  return { item: { ...item, hasVisited: visitCount > 1 } };
}

async function getVisitMutationContext(
  id: string,
): Promise<
  { visit: VisitRecord; item: AtlasItem; visitCount: number } | undefined
> {
  const row = await getD1()
    .prepare(
      `WITH requested_visit AS (
         SELECT visits.*,
                (
                  SELECT COUNT(*) FROM visits AS sibling
                  WHERE sibling.item_id = visits.item_id
                ) AS visit_count
         FROM visits
         WHERE visits.id = ?
       )
       SELECT requested_visit.id AS visit_id,
              requested_visit.item_id AS visit_item_id,
              requested_visit.item_title AS visit_item_title,
              requested_visit.visited_at AS visit_visited_at,
              requested_visit.note AS visit_note,
              requested_visit.created_at AS visit_created_at,
              requested_visit.updated_at AS visit_updated_at,
              requested_visit.visit_count,
              items.payload_json,
              overrides.title AS override_title,
              overrides.description AS override_description,
              overrides.personal_state AS override_personal_state,
              overrides.updated_at AS override_updated_at,
              assessments.overall_rating,
              assessments.is_favorite,
              assessments.has_visited,
              CASE WHEN requested_visit.visit_count > 0 THEN 1 ELSE 0 END AS has_visit,
              tombstones.item_id AS tombstone_id
       FROM requested_visit
       LEFT JOIN atlas_items AS items ON items.id = requested_visit.item_id
       LEFT JOIN atlas_item_overrides AS overrides
         ON overrides.item_id = requested_visit.item_id
       LEFT JOIN place_assessments AS assessments
         ON assessments.item_id = requested_visit.item_id
       LEFT JOIN atlas_item_tombstones AS tombstones
         ON tombstones.item_id = requested_visit.item_id`,
    )
    .bind(id)
    .first<ResolvedVisitMutationRow>();
  if (!row) return undefined;
  const item = resolveAtlasItem(row.visit_item_id, row);
  if (!item) throw new Error('Atlas item not found');
  return {
    visit: {
      id: row.visit_id,
      itemId: row.visit_item_id,
      itemTitle: row.visit_item_title,
      visitedAt: row.visit_visited_at,
      note: row.visit_note ?? undefined,
      createdAt: row.visit_created_at,
      updatedAt: row.visit_updated_at,
    },
    item,
    visitCount: row.visit_count,
  };
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
