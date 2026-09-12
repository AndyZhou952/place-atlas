import type { PlaceAssessment } from '@/product/application/assessments/place-assessment';
import type { PersonalState } from '@/product/application/catalog/atlas-item';
import type {
  CreateVisitRecords,
  UpdateVisitRecords,
  VisitItemRecordContext,
  VisitMutationContext,
  VisitRecordState,
} from '@/product/application/visits/visit-state';
import type { Visit } from '@/product/application/visits/visit';

interface VisitRow {
  readonly id: string;
  readonly item_id: string;
  readonly item_title: string;
  readonly visited_at: string;
  readonly note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ItemContextRow {
  readonly item_id: string;
  readonly payload_json?: string | null;
  readonly override_title?: string | null;
  readonly override_description?: string | null;
  readonly override_personal_state?: PersonalState | null;
  readonly override_updated_at?: string | null;
  readonly overall_rating?: number | null;
  readonly is_favorite?: number | null;
  readonly has_visited?: number | null;
  readonly summary?: string | null;
  readonly assessment_updated_at?: string | null;
  readonly tombstone_id?: string | null;
  readonly visit_count?: number | null;
}

interface VisitContextRow extends VisitRow, ItemContextRow {}

export class D1VisitState implements VisitRecordState {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async list(): Promise<readonly Visit[]> {
    try {
      const result = await this.#database
        .prepare(
          `SELECT id, item_id, item_title, visited_at, note, created_at, updated_at
           FROM visits ORDER BY visited_at DESC, created_at DESC`,
        )
        .all<VisitRow>();
      return result.results.map(toVisit);
    } catch (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
  }

  async readItemContext(itemId: string): Promise<VisitItemRecordContext> {
    const row = await this.#database
      .prepare(itemContextSql)
      .bind(itemId)
      .first<ItemContextRow>();
    return toItemContext(row ?? { item_id: itemId });
  }

  async readVisitContext(
    id: string,
  ): Promise<VisitMutationContext | undefined> {
    const row = await this.#database
      .prepare(visitContextSql)
      .bind(id)
      .first<VisitContextRow>();
    return row ? { ...toItemContext(row), visit: toVisit(row) } : undefined;
  }

  async create({ visit, assessment }: CreateVisitRecords) {
    const statements = [this.insertVisitStatement(visit)];
    if (assessment) statements.push(this.upsertRatingStatement(assessment));
    const results = await this.#database.batch(statements);
    return { inserted: (results[0]?.meta.changes ?? 0) > 0 };
  }

  async update({ visit, assessment }: UpdateVisitRecords): Promise<void> {
    const statements = [
      this.#database
        .prepare(
          `UPDATE visits SET visited_at = ?, note = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(visit.visitedAt, visit.note ?? null, visit.updatedAt, visit.id),
    ];
    if (assessment) statements.push(this.upsertRatingStatement(assessment));
    await this.#database.batch(statements);
  }

  private insertVisitStatement(visit: Visit): D1PreparedStatement {
    return this.#database
      .prepare(
        `INSERT INTO visits
         (id, item_id, item_title, visited_at, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        visit.id,
        visit.itemId,
        visit.itemTitle,
        visit.visitedAt,
        visit.note ?? null,
        visit.createdAt,
        visit.updatedAt,
      );
  }

  private upsertRatingStatement(
    assessment: PlaceAssessment,
  ): D1PreparedStatement {
    return this.#database
      .prepare(
        `INSERT INTO place_assessments
         (item_id, overall_rating, is_favorite, has_visited, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET
           overall_rating = excluded.overall_rating,
           updated_at = excluded.updated_at`,
      )
      .bind(
        assessment.itemId,
        assessment.overallRating ?? null,
        assessment.isFavorite ? 1 : 0,
        assessment.manualVisited ? 1 : 0,
        assessment.summary ?? null,
        assessment.updatedAt,
        assessment.updatedAt,
      );
  }
}

function toVisit(row: VisitRow): Visit {
  return {
    id: row.id,
    itemId: row.item_id,
    itemTitle: row.item_title,
    visitedAt: row.visited_at,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toItemContext(row: ItemContextRow): VisitItemRecordContext {
  const hasOverride = row.override_updated_at != null;
  const hasAssessment = row.assessment_updated_at != null;
  return {
    itemId: row.item_id,
    dynamicPayload: row.payload_json ?? undefined,
    override: hasOverride
      ? {
          itemId: row.item_id,
          title: row.override_title ?? '',
          description: row.override_description ?? '',
          personalState: row.override_personal_state ?? 'candidate',
          updatedAt: row.override_updated_at ?? '',
        }
      : undefined,
    assessment: hasAssessment
      ? {
          itemId: row.item_id,
          overallRating: row.overall_rating ?? undefined,
          isFavorite: Boolean(row.is_favorite),
          manualVisited: Boolean(row.has_visited),
          summary: row.summary ?? undefined,
          updatedAt: row.assessment_updated_at ?? '',
        }
      : undefined,
    tombstoned: row.tombstone_id != null,
    visitCount: row.visit_count ?? 0,
  };
}

const itemContextSql = `WITH requested(item_id) AS (VALUES (?))
  SELECT requested.item_id,
         items.payload_json,
         overrides.title AS override_title,
         overrides.description AS override_description,
         overrides.personal_state AS override_personal_state,
         overrides.updated_at AS override_updated_at,
         assessments.overall_rating,
         assessments.is_favorite,
         assessments.has_visited,
         assessments.summary,
         assessments.updated_at AS assessment_updated_at,
         tombstones.item_id AS tombstone_id,
         (SELECT COUNT(*) FROM visits WHERE item_id = requested.item_id) AS visit_count
  FROM requested
  LEFT JOIN atlas_items AS items ON items.id = requested.item_id
  LEFT JOIN atlas_item_overrides AS overrides ON overrides.item_id = requested.item_id
  LEFT JOIN place_assessments AS assessments ON assessments.item_id = requested.item_id
  LEFT JOIN atlas_item_tombstones AS tombstones ON tombstones.item_id = requested.item_id`;

const visitContextSql = `WITH requested_visit AS (
    SELECT id, item_id, item_title, visited_at, note, created_at, updated_at
    FROM visits WHERE id = ?
  )
  SELECT requested_visit.*,
         items.payload_json,
         overrides.title AS override_title,
         overrides.description AS override_description,
         overrides.personal_state AS override_personal_state,
         overrides.updated_at AS override_updated_at,
         assessments.overall_rating,
         assessments.is_favorite,
         assessments.has_visited,
         assessments.summary,
         assessments.updated_at AS assessment_updated_at,
         tombstones.item_id AS tombstone_id,
         (SELECT COUNT(*) FROM visits WHERE item_id = requested_visit.item_id) AS visit_count
  FROM requested_visit
  LEFT JOIN atlas_items AS items ON items.id = requested_visit.item_id
  LEFT JOIN atlas_item_overrides AS overrides ON overrides.item_id = requested_visit.item_id
  LEFT JOIN place_assessments AS assessments ON assessments.item_id = requested_visit.item_id
  LEFT JOIN atlas_item_tombstones AS tombstones ON tombstones.item_id = requested_visit.item_id`;

function isMissingTable(error: unknown): boolean {
  return error instanceof Error && error.message.includes('no such table');
}
