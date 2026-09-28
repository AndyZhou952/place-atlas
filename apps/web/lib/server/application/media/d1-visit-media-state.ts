import type { VisitMediaRecordState } from '@/product/application/media/media-state';
import type {
  VisitMediaFilters,
  VisitMediaMetadata,
} from '@/product/application/media/visit-media';
import type { AtomicMutationCommit } from '@/product/application/atlas-application';

import { commitD1MutationAtomically } from '../d1-mutation-receipt-state.ts';

interface VisitMediaRow {
  readonly id: string;
  readonly display_id: string;
  readonly visit_id: string;
  readonly item_id: string;
  readonly object_key: string;
  readonly original_filename: string;
  readonly content_type: string;
  readonly byte_size: number;
  readonly content_sha256: string;
  readonly caption: string | null;
  readonly score: number | null;
  readonly display_order: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface VisitMediaContextRow {
  readonly item_id: string;
  readonly next_display_order: number;
}

export class D1VisitMediaState implements VisitMediaRecordState {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async list(filters: VisitMediaFilters) {
    const predicates: string[] = [];
    const values: string[] = [];
    if (filters.visitId) {
      predicates.push('visit_id = ?');
      values.push(filters.visitId);
    }
    if (filters.itemId) {
      predicates.push('item_id = ?');
      values.push(filters.itemId);
    }
    const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
    const statement = this.#database.prepare(
      `${selectVisitMediaSql} ${where}
       ORDER BY visit_id, display_order, created_at`,
    );
    const result = await (
      values.length ? statement.bind(...values) : statement
    ).all<VisitMediaRow>();
    return result.results.map(toVisitMediaMetadata);
  }

  async find(id: string) {
    const row = await this.#database
      .prepare(`${selectVisitMediaSql} WHERE id = ?`)
      .bind(id)
      .first<VisitMediaRow>();
    return row ? toVisitMediaMetadata(row) : undefined;
  }

  async findByDisplayId(displayId: string) {
    const row = await this.#database
      .prepare(`${selectVisitMediaSql} WHERE display_id = ?`)
      .bind(displayId)
      .first<VisitMediaRow>();
    return row ? toVisitMediaMetadata(row) : undefined;
  }

  async getVisitContext(visitId: string) {
    const row = await this.#database
      .prepare(
        `SELECT visits.item_id,
                COALESCE(MAX(visit_media.display_order), -1) + 1 AS next_display_order
         FROM visits
         LEFT JOIN visit_media ON visit_media.visit_id = visits.id
         WHERE visits.id = ?
         GROUP BY visits.item_id`,
      )
      .bind(visitId)
      .first<VisitMediaContextRow>();
    return row
      ? { itemId: row.item_id, nextDisplayOrder: row.next_display_order }
      : undefined;
  }

  async insert(
    records: readonly VisitMediaMetadata[],
    atomicCommit?: AtomicMutationCommit,
  ) {
    await commitD1MutationAtomically(
      this.#database,
      records.map((media) =>
        this.#database
          .prepare(
            `INSERT INTO visit_media
             (id, display_id, visit_id, item_id, object_key, original_filename, content_type,
              byte_size, content_sha256, caption, score, display_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            media.id,
            media.displayId,
            media.visitId,
            media.itemId,
            media.objectKey,
            media.originalFilename,
            media.contentType,
            media.byteSize,
            media.contentSha256,
            media.caption ?? null,
            media.score ?? null,
            media.displayOrder,
            media.createdAt,
            media.updatedAt,
          ),
      ),
      atomicCommit,
    );
  }

  async updateCaption(
    id: string,
    caption: string | undefined,
    updatedAt: string,
    atomicCommit?: AtomicMutationCommit,
  ) {
    if (atomicCommit) {
      const existing = await this.find(id);
      if (!existing) return undefined;
      await commitD1MutationAtomically(
        this.#database,
        [
          this.#database
            .prepare(
              'UPDATE visit_media SET caption = ?, updated_at = ? WHERE id = ?',
            )
            .bind(caption ?? null, updatedAt, id),
        ],
        atomicCommit,
      );
      return { ...existing, caption, updatedAt };
    }
    const row = await this.#database
      .prepare(
        `UPDATE visit_media SET caption = ?, updated_at = ? WHERE id = ?
         RETURNING id, display_id, visit_id, item_id, object_key, original_filename,
                   content_type, byte_size, content_sha256, caption,
                   score, display_order, created_at, updated_at`,
      )
      .bind(caption ?? null, updatedAt, id)
      .first<VisitMediaRow>();
    return row ? toVisitMediaMetadata(row) : undefined;
  }

  async updateScore(
    id: string,
    score: number | undefined,
    updatedAt: string,
    atomicCommit?: AtomicMutationCommit,
  ) {
    if (atomicCommit) {
      const existing = await this.find(id);
      if (!existing) return undefined;
      await commitD1MutationAtomically(
        this.#database,
        [
          this.#database
            .prepare(
              'UPDATE visit_media SET score = ?, updated_at = ? WHERE id = ?',
            )
            .bind(score ?? null, updatedAt, id),
        ],
        atomicCommit,
      );
      return { ...existing, score, updatedAt };
    }
    const row = await this.#database
      .prepare(
        `UPDATE visit_media SET score = ?, updated_at = ? WHERE id = ?
         RETURNING id, display_id, visit_id, item_id, object_key, original_filename,
                   content_type, byte_size, content_sha256, caption,
                   score, display_order, created_at, updated_at`,
      )
      .bind(score ?? null, updatedAt, id)
      .first<VisitMediaRow>();
    return row ? toVisitMediaMetadata(row) : undefined;
  }

  async delete(id: string, atomicCommit?: AtomicMutationCommit) {
    if (atomicCommit) {
      const existing = await this.find(id);
      if (!existing) return undefined;
      await commitD1MutationAtomically(
        this.#database,
        [
          this.#database
            .prepare('DELETE FROM visit_media WHERE id = ?')
            .bind(id),
        ],
        atomicCommit,
      );
      return existing;
    }
    const row = await this.#database
      .prepare(
        `DELETE FROM visit_media WHERE id = ?
         RETURNING id, display_id, visit_id, item_id, object_key, original_filename,
                   content_type, byte_size, content_sha256, caption,
                   score, display_order, created_at, updated_at`,
      )
      .bind(id)
      .first<VisitMediaRow>();
    return row ? toVisitMediaMetadata(row) : undefined;
  }
}

function toVisitMediaMetadata(row: VisitMediaRow): VisitMediaMetadata {
  return {
    id: row.id,
    displayId: row.display_id,
    visitId: row.visit_id,
    itemId: row.item_id,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    contentSha256: row.content_sha256,
    caption: row.caption ?? undefined,
    ...(row.score === null || row.score === undefined
      ? {}
      : { score: row.score }),
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const selectVisitMediaSql = `SELECT id, display_id, visit_id, item_id, object_key,
  original_filename, content_type, byte_size, content_sha256, caption, score,
  display_order, created_at, updated_at FROM visit_media`;
