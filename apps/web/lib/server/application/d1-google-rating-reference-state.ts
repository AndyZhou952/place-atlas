import type { AtomicMutationCommit } from '../../../product/application/atlas-application.ts';
import type {
  GoogleRatingReference,
  GoogleRatingReferenceState,
} from '../../../product/application/catalog/google-rating-reference-operations.ts';
import { commitD1MutationAtomically } from './d1-mutation-receipt-state.ts';

export class D1GoogleRatingReferenceState implements GoogleRatingReferenceState {
  readonly #database: D1Database;
  constructor(database: D1Database) {
    this.#database = database;
  }
  async list(): Promise<readonly GoogleRatingReference[]> {
    const rows = await this.#database
      .prepare('SELECT reference_json FROM atlas_google_rating_references')
      .all<{ reference_json: string }>();
    return rows.results.map(
      (row) => JSON.parse(row.reference_json) as GoogleRatingReference,
    );
  }
  async save(
    reference: GoogleRatingReference,
    commit?: AtomicMutationCommit,
  ): Promise<void> {
    await commitD1MutationAtomically(
      this.#database,
      [
        this.#database
          .prepare(`INSERT INTO atlas_google_rating_references (item_id, reference_json, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET reference_json = excluded.reference_json, updated_at = excluded.updated_at`)
          .bind(
            reference.itemId,
            JSON.stringify(reference),
            reference.capturedAt,
          ),
      ],
      commit,
    );
  }
}
