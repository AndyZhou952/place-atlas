import type {
  AtlasItemOverrideRecord,
  CatalogRecordState,
  CatalogStateSnapshot,
  PlaceAssessmentRecord,
  VisitCountRecord,
} from '@/product/application/catalog/catalog-state';
import type { AtlasItem } from '@/product/application/catalog/atlas-item';
import type { AtomicMutationCommit } from '@/product/application/atlas-application';

import { commitD1MutationAtomically } from './d1-mutation-receipt-state.ts';

interface ItemRow {
  readonly payload_json: string;
}

interface ReviewCandidateRow {
  readonly payload_json: string;
}

interface OverrideRow {
  readonly item_id: string;
  readonly title: string;
  readonly description: string;
  readonly personal_state: AtlasItemOverrideRecord['personalState'];
  readonly updated_at: string;
}

interface AssessmentRow {
  readonly item_id: string;
  readonly overall_rating: number | null;
  readonly is_favorite: number;
  readonly has_visited: number;
}

interface TombstoneRow {
  readonly item_id: string;
}

interface VisitCountRow {
  readonly item_id: string;
  readonly visit_count: number;
}

export class D1CatalogState implements CatalogRecordState {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async readSnapshot(): Promise<CatalogStateSnapshot> {
    const [
      itemRows,
      reviewCandidateRows,
      overrideRows,
      assessmentRows,
      tombstoneRows,
      visitRows,
    ] = await Promise.all([
      this.allOrEmpty<ItemRow>(
        'SELECT id, payload_json FROM atlas_items ORDER BY created_at DESC',
      ),
      this.allOrEmpty<ReviewCandidateRow>(
        'SELECT id, payload_json FROM atlas_review_candidates ORDER BY created_at DESC',
      ),
      this.allOrEmpty<OverrideRow>(
        'SELECT item_id, title, description, personal_state, updated_at FROM atlas_item_overrides',
      ),
      this.allOrEmpty<AssessmentRow>(
        `SELECT item_id, overall_rating, is_favorite, has_visited
           FROM place_assessments`,
      ),
      this.allOrEmpty<TombstoneRow>(
        'SELECT item_id FROM atlas_item_tombstones',
      ),
      this.allOrEmpty<VisitCountRow>(
        'SELECT item_id, COUNT(*) AS visit_count FROM visits GROUP BY item_id',
      ),
    ]);

    return {
      dynamicPayloads: [...itemRows, ...reviewCandidateRows].map(
        (row) => row.payload_json,
      ),
      overrides: overrideRows.map((row) => ({
        itemId: row.item_id,
        title: row.title,
        description: row.description,
        personalState: row.personal_state,
        updatedAt: row.updated_at,
      })),
      assessments: assessmentRows.map(
        (row): PlaceAssessmentRecord => ({
          itemId: row.item_id,
          overallRating: row.overall_rating ?? undefined,
          isFavorite: Boolean(row.is_favorite),
          manualVisited: Boolean(row.has_visited),
        }),
      ),
      tombstoneIds: tombstoneRows.map((row) => row.item_id),
      visitCounts: visitRows.map(
        (row): VisitCountRecord => ({
          itemId: row.item_id,
          count: row.visit_count,
        }),
      ),
    };
  }

  async saveDynamicItem(
    item: AtlasItem,
    storedAt: string,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<void> {
    await commitD1MutationAtomically(
      this.database,
      [
        this.database
          .prepare(
            `INSERT INTO atlas_items (id, payload_json, verification_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           verification_status = excluded.verification_status,
           updated_at = excluded.updated_at`,
          )
          .bind(
            item.id,
            JSON.stringify(item),
            item.verificationStatus,
            storedAt,
            storedAt,
          ),
        this.database.prepare(incrementCatalogRevisionSql),
      ],
      atomicCommit,
    );
  }

  async saveOverride(
    override: AtlasItemOverrideRecord,
    atomicCommit?: AtomicMutationCommit,
  ): Promise<void> {
    await commitD1MutationAtomically(
      this.database,
      [
        this.database
          .prepare(
            `INSERT INTO atlas_item_overrides (item_id, title, description, personal_state, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(item_id) DO UPDATE SET
           title = excluded.title,
           description = excluded.description,
           personal_state = excluded.personal_state,
           updated_at = excluded.updated_at`,
          )
          .bind(
            override.itemId,
            override.title,
            override.description,
            override.personalState,
            override.updatedAt,
          ),
        this.database.prepare(incrementCatalogRevisionSql),
      ],
      atomicCommit,
    );
  }

  private async allOrEmpty<Row>(sql: string): Promise<Row[]> {
    try {
      const result = await this.database.prepare(sql).all<Row>();
      return result.results;
    } catch (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
  }
}

const incrementCatalogRevisionSql =
  'UPDATE atlas_catalog_revision SET revision_number = revision_number + 1 ' +
  'WHERE singleton = 1';

function isMissingTable(error: unknown): boolean {
  return error instanceof Error && error.message.includes('no such table');
}
