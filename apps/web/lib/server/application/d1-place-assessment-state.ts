import type { PlaceAssessment } from '@/product/application/assessments/place-assessment';
import type {
  PlaceAssessmentContext,
  PlaceAssessmentRecordState,
} from '@/product/application/assessments/place-assessment-state';
import type { AtomicMutationCommit } from '@/product/application/atlas-application';

import { commitD1MutationAtomically } from './d1-mutation-receipt-state.ts';

interface AssessmentRow {
  readonly item_id: string;
  readonly overall_rating: number | null;
  readonly is_favorite: number;
  readonly has_visited: number;
  readonly summary: string | null;
  readonly updated_at: string;
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
    const [assessmentRow, visitCountRow] = await Promise.all([
      this.#database
        .prepare(
          `SELECT item_id, overall_rating, is_favorite, has_visited, summary, updated_at
           FROM place_assessments WHERE item_id = ?`,
        )
        .bind(itemId)
        .first<AssessmentRow>(),
      this.#database
        .prepare('SELECT COUNT(*) AS visit_count FROM visits WHERE item_id = ?')
        .bind(itemId)
        .first<VisitCountRow>(),
    ]);

    return {
      assessment: assessmentRow
        ? {
            itemId: assessmentRow.item_id,
            overallRating: assessmentRow.overall_rating ?? undefined,
            isFavorite: Boolean(assessmentRow.is_favorite),
            manualVisited: Boolean(assessmentRow.has_visited),
            summary: assessmentRow.summary ?? undefined,
            updatedAt: assessmentRow.updated_at,
          }
        : undefined,
      visitCount: visitCountRow?.visit_count ?? 0,
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
