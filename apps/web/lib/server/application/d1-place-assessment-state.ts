import type { PlaceAssessment } from '@/product/application/assessments/place-assessment';
import type {
  PlaceAssessmentContext,
  PlaceAssessmentRecordState,
} from '@/product/application/assessments/place-assessment-state';
import type { AtomicMutationCommit } from '@/product/application/atlas-application';

import { commitD1MutationAtomically } from './d1-mutation-receipt-state.ts';

interface AssessmentRow {
  readonly item_id: string | null;
  readonly overall_rating: number | null;
  readonly is_favorite: number | null;
  readonly has_visited: number | null;
  readonly summary: string | null;
  readonly updated_at: string | null;
}

interface VisitCountRow {
  readonly visit_count: number;
}

export class D1PlaceAssessmentState implements PlaceAssessmentRecordState {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async read(itemId: string): Promise<PlaceAssessmentContext> {
    const row = await this.#database
      .prepare(
        `SELECT assessment.item_id, assessment.overall_rating,
                assessment.is_favorite, assessment.has_visited,
                assessment.summary, assessment.updated_at,
                (SELECT COUNT(*) FROM visits WHERE item_id = ?) AS visit_count
         FROM (SELECT 1) AS one_row
         LEFT JOIN place_assessments AS assessment ON assessment.item_id = ?`,
      )
      .bind(itemId, itemId)
      .first<AssessmentRow & VisitCountRow>();

    return {
      assessment: row?.item_id
        ? {
            itemId: row.item_id,
            overallRating: row.overall_rating ?? undefined,
            isFavorite: Boolean(row.is_favorite),
            manualVisited: Boolean(row.has_visited),
            summary: row.summary ?? undefined,
            updatedAt: row.updated_at ?? '',
          }
        : undefined,
      visitCount: row?.visit_count ?? 0,
    };
  }

  async save(
    assessment: PlaceAssessment,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<void> {
    const statement = this.#database
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
        assessment.itemId,
        assessment.overallRating ?? null,
        assessment.isFavorite ? 1 : 0,
        assessment.manualVisited ? 1 : 0,
        assessment.summary ?? null,
        assessment.updatedAt,
        assessment.updatedAt,
      );
    await commitD1MutationAtomically(this.#database, [statement], atomicCommit);
  }
}
