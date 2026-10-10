import type { PersonalState } from '@/product/application/catalog/atlas-item';
import type {
  DestructiveItemContext,
  DestructiveRecordState,
} from '@/product/application/destructive/destructive-state';
import type { AtomicMutationCommit } from '@/product/application/atlas-application';

import { commitD1MutationAtomically } from './d1-mutation-receipt-state.ts';

interface DestructiveContextRow {
  readonly item_id: string;
  readonly payload_json?: string | null;
  readonly review_candidate_payload_json?: string | null;
  readonly override_title?: string | null;
  readonly override_description?: string | null;
  readonly override_personal_state?: PersonalState | null;
  readonly override_updated_at?: string | null;
  readonly overall_rating?: number | null;
  readonly is_favorite?: number | null;
  readonly has_visited?: number | null;
  readonly assessment_updated_at?: string | null;
  readonly tombstone_id?: string | null;
  readonly visit_count?: number | null;
  readonly media_object_keys_json?: string | null;
}

interface VisitDeletionRow extends DestructiveContextRow {
  readonly visit_id: string;
}

export class D1DestructiveState implements DestructiveRecordState {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async readVisitDeletion(
    id: string,
  ): Promise<DestructiveItemContext | undefined> {
    const row = await this.#database
      .prepare(visitDeletionContextSql)
      .bind(id)
      .first<VisitDeletionRow>();
    return row ? toContext(row) : undefined;
  }

  async commitVisitDeletion(
    id: string,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<void> {
    await commitD1MutationAtomically(
      this.#database,
      [
        this.#database
          .prepare('DELETE FROM visit_media WHERE visit_id = ?')
          .bind(id),
        this.#database.prepare('DELETE FROM visits WHERE id = ?').bind(id),
        this.#database
          .prepare('DELETE FROM journal_entries WHERE id = ?')
          .bind(id),
      ],
      atomicCommit,
    );
  }

  async readItemDeletion(id: string): Promise<DestructiveItemContext> {
    const row = await this.#database
      .prepare(itemDeletionContextSql)
      .bind(id)
      .first<DestructiveContextRow>();
    return toContext(row ?? { item_id: id });
  }

  async commitItemDeletion(
    id: string,
    deletedAt: string,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<void> {
    await commitD1MutationAtomically(
      this.#database,
      [
        this.#database
          .prepare('DELETE FROM visit_media WHERE item_id = ?')
          .bind(id),
        this.#database.prepare('DELETE FROM visits WHERE item_id = ?').bind(id),
        this.#database
          .prepare('DELETE FROM journal_entries WHERE item_id = ?')
          .bind(id),
        this.#database
          .prepare('DELETE FROM place_assessments WHERE item_id = ?')
          .bind(id),
        this.#database
          .prepare('DELETE FROM atlas_item_overrides WHERE item_id = ?')
          .bind(id),
        this.#database
          .prepare(
            'DELETE FROM atlas_item_location_snapshots WHERE item_id = ?',
          )
          .bind(id),
        this.#database
          .prepare('DELETE FROM atlas_item_tabelog_snapshots WHERE item_id = ?')
          .bind(id),
        this.#database
          .prepare(
            'DELETE FROM atlas_item_reservation_snapshots WHERE item_id = ?',
          )
          .bind(id),
        this.#database
          .prepare('DELETE FROM atlas_place_identities WHERE item_id = ?')
          .bind(id),
        this.#database
          .prepare('DELETE FROM atlas_review_candidates WHERE id = ?')
          .bind(id),
        this.#database
          .prepare(
            'DELETE FROM atlas_google_rating_references WHERE item_id = ?',
          )
          .bind(id),
        this.#database.prepare('DELETE FROM atlas_items WHERE id = ?').bind(id),
        this.#database
          .prepare(
            `INSERT INTO atlas_item_tombstones (item_id, deleted_at)
           VALUES (?, ?)
           ON CONFLICT(item_id) DO UPDATE SET deleted_at = excluded.deleted_at`,
          )
          .bind(id, deletedAt),
        this.#database.prepare(
          'UPDATE atlas_catalog_revision ' +
            'SET revision_number = revision_number + 1 WHERE singleton = 1',
        ),
      ],
      atomicCommit,
    );
  }
}

function toContext(row: DestructiveContextRow): DestructiveItemContext {
  const hasOverride = row.override_updated_at != null;
  const hasAssessment = row.assessment_updated_at != null;
  return {
    itemId: row.item_id,
    dynamicPayload:
      row.payload_json ?? row.review_candidate_payload_json ?? undefined,
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
          updatedAt: row.assessment_updated_at ?? '',
        }
      : undefined,
    tombstoned: row.tombstone_id != null,
    visitCount: row.visit_count ?? 0,
    mediaObjectKeys: readStringArray(row.media_object_keys_json),
  };
}

const visitDeletionContextSql = `WITH requested_visit AS (
    SELECT id, item_id FROM visits WHERE id = ?
  )
  SELECT requested_visit.id AS visit_id,
         requested_visit.item_id,
         items.payload_json,
         review_candidates.payload_json AS review_candidate_payload_json,
         overrides.title AS override_title,
         overrides.description AS override_description,
         overrides.personal_state AS override_personal_state,
         overrides.updated_at AS override_updated_at,
         assessments.overall_rating,
         assessments.is_favorite,
         assessments.has_visited,
         assessments.updated_at AS assessment_updated_at,
         tombstones.item_id AS tombstone_id,
         (SELECT COUNT(*) FROM visits WHERE item_id = requested_visit.item_id) AS visit_count,
         COALESCE((
           SELECT json_group_array(object_key)
           FROM visit_media WHERE visit_id = requested_visit.id
         ), '[]') AS media_object_keys_json
  FROM requested_visit
  LEFT JOIN atlas_items AS items ON items.id = requested_visit.item_id
  LEFT JOIN atlas_review_candidates AS review_candidates ON review_candidates.id = requested_visit.item_id
  LEFT JOIN atlas_item_overrides AS overrides ON overrides.item_id = requested_visit.item_id
  LEFT JOIN place_assessments AS assessments ON assessments.item_id = requested_visit.item_id
  LEFT JOIN atlas_item_tombstones AS tombstones ON tombstones.item_id = requested_visit.item_id`;

const itemDeletionContextSql = `WITH requested(item_id) AS (VALUES (?))
  SELECT requested.item_id,
         items.payload_json,
         overrides.title AS override_title,
         overrides.description AS override_description,
         overrides.personal_state AS override_personal_state,
         overrides.updated_at AS override_updated_at,
         assessments.overall_rating,
         assessments.is_favorite,
         assessments.has_visited,
         assessments.updated_at AS assessment_updated_at,
         tombstones.item_id AS tombstone_id,
         (SELECT COUNT(*) FROM visits WHERE item_id = requested.item_id) AS visit_count,
         COALESCE((
           SELECT json_group_array(object_key)
           FROM visit_media WHERE item_id = requested.item_id
         ), '[]') AS media_object_keys_json
  FROM requested
  LEFT JOIN atlas_items AS items ON items.id = requested.item_id
  LEFT JOIN atlas_item_overrides AS overrides ON overrides.item_id = requested.item_id
  LEFT JOIN place_assessments AS assessments ON assessments.item_id = requested.item_id
  LEFT JOIN atlas_item_tombstones AS tombstones ON tombstones.item_id = requested.item_id`;

function readStringArray(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}
