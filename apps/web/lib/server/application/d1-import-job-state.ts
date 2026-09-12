import type { ImportJob } from '@/product/application/import-jobs/import-job';
import type { ImportJobRecordState } from '@/product/application/import-jobs/import-job-state';

interface ImportJobRow {
  readonly id: string;
  readonly source_ref: string;
  readonly creator_name: string;
  readonly platform: string;
  readonly status: ImportJob['status'];
  readonly discovered_count: number;
  readonly needs_review_count: number;
  readonly message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class D1ImportJobState implements ImportJobRecordState {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async list(): Promise<readonly ImportJob[]> {
    try {
      const result = await this.#database
        .prepare(
          `SELECT id, source_ref, creator_name, platform, status,
                  discovered_count, needs_review_count, message, created_at, updated_at
           FROM import_jobs ORDER BY created_at DESC`,
        )
        .all<ImportJobRow>();
      return result.results.map(toImportJob);
    } catch (error) {
      if (isMissingTable(error)) return [];
      throw error;
    }
  }

  async insert(job: ImportJob): Promise<void> {
    await this.#database
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
        job.message ?? null,
        job.createdAt,
        job.updatedAt,
      )
      .run();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.#database
      .prepare('DELETE FROM import_jobs WHERE id = ?')
      .bind(id)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }
}

function isMissingTable(error: unknown): boolean {
  return error instanceof Error && error.message.includes('no such table');
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
