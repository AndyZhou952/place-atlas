import { getD1, getMediaBucket } from '@/db';
import type { VisitMediaRecord } from '@/features/atlas/model';

import { assertAllowedImage, normalizeMediaCaption } from './media-policy';

interface VisitMediaRow {
  id: string;
  visit_id: string;
  item_id: string;
  object_key: string;
  original_filename: string;
  content_type: string;
  byte_size: number;
  content_sha256: string;
  caption: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

interface VisitMediaContextRow {
  item_id: string;
  next_display_order: number;
}

export interface VisitMediaUpload {
  readonly id?: string;
  readonly originalFilename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly caption?: string;
}

export async function listVisitMedia(filters?: {
  readonly visitId?: string;
  readonly itemId?: string;
}): Promise<VisitMediaRecord[]> {
  const predicates: string[] = [];
  const values: string[] = [];
  if (filters?.visitId) {
    predicates.push('visit_id = ?');
    values.push(filters.visitId);
  }
  if (filters?.itemId) {
    predicates.push('item_id = ?');
    values.push(filters.itemId);
  }
  const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
  const statement = getD1().prepare(
    `${selectVisitMediaSql} ${where}
     ORDER BY visit_id, display_order, created_at`,
  );
  const result = await (
    values.length ? statement.bind(...values) : statement
  ).all<VisitMediaRow>();
  return result.results.map(toVisitMedia);
}

export async function attachVisitMedia(
  visitId: string,
  uploads: readonly VisitMediaUpload[],
): Promise<VisitMediaRecord[]> {
  const db = getD1();
  const context = await db
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
  if (!context) throw new Error('Journal entry not found');

  const now = new Date().toISOString();
  const bucket = getMediaBucket();
  const results = await Promise.allSettled(
    uploads.map(async (upload, index) => {
      assertAllowedImage(upload.contentType, upload.bytes);
      const id = upload.id ?? crypto.randomUUID();
      const objectKey = `visits/${visitId}/${id}`;
      const contentSha256 = await sha256(upload.bytes);
      const caption = normalizeMediaCaption(upload.caption);
      await bucket.put(objectKey, upload.bytes, {
        httpMetadata: { contentType: upload.contentType },
        customMetadata: {
          mediaId: id,
          visitId,
          sha256: contentSha256,
        },
      });
      return {
        id,
        visitId,
        itemId: context.item_id,
        objectKey,
        originalFilename: upload.originalFilename || 'image',
        contentType: upload.contentType,
        byteSize: upload.bytes.byteLength,
        contentSha256,
        caption,
        displayOrder: context.next_display_order + index,
        createdAt: now,
        updatedAt: now,
      };
    }),
  );
  const prepared = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failed) {
    await Promise.allSettled(
      prepared.map((media) => bucket.delete(media.objectKey)),
    );
    throw failed.reason;
  }

  try {
    await db.batch(
      prepared.map((media) =>
        db
          .prepare(
            `INSERT INTO visit_media
             (id, visit_id, item_id, object_key, original_filename, content_type,
              byte_size, content_sha256, caption, display_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            media.id,
            media.visitId,
            media.itemId,
            media.objectKey,
            media.originalFilename,
            media.contentType,
            media.byteSize,
            media.contentSha256,
            media.caption ?? null,
            media.displayOrder,
            media.createdAt,
            media.updatedAt,
          ),
      ),
    );
  } catch (error) {
    await Promise.allSettled(
      prepared.map((media) => bucket.delete(media.objectKey)),
    );
    throw error;
  }

  return prepared.map(({ objectKey: _objectKey, ...media }) => ({
    ...media,
    contentUrl: mediaContentUrl(media.id),
  }));
}

export async function updateVisitMediaCaption(
  id: string,
  value: unknown,
): Promise<VisitMediaRecord | undefined> {
  const caption = normalizeMediaCaption(value);
  const updatedAt = new Date().toISOString();
  const result = await getD1()
    .prepare(
      `UPDATE visit_media SET caption = ?, updated_at = ? WHERE id = ?
       RETURNING id, visit_id, item_id, object_key, original_filename,
                 content_type, byte_size, content_sha256, caption,
                 display_order, created_at, updated_at`,
    )
    .bind(caption ?? null, updatedAt, id)
    .first<VisitMediaRow>();
  return result ? toVisitMedia(result) : undefined;
}

export async function deleteVisitMedia(id: string): Promise<boolean> {
  const db = getD1();
  const row = await db
    .prepare('SELECT object_key FROM visit_media WHERE id = ?')
    .bind(id)
    .first<{ object_key: string }>();
  if (!row) return false;
  await db.prepare('DELETE FROM visit_media WHERE id = ?').bind(id).run();
  await getMediaBucket().delete(row.object_key);
  return true;
}

export async function getVisitMediaObject(id: string): Promise<
  | {
      readonly record: VisitMediaRecord;
      readonly object: R2ObjectBody;
    }
  | undefined
> {
  const row = await getD1()
    .prepare(`${selectVisitMediaSql} WHERE id = ?`)
    .bind(id)
    .first<VisitMediaRow>();
  if (!row) return undefined;
  const object = await getMediaBucket().get(row.object_key);
  return object ? { record: toVisitMedia(row), object } : undefined;
}

function toVisitMedia(row: VisitMediaRow): VisitMediaRecord {
  return {
    id: row.id,
    visitId: row.visit_id,
    itemId: row.item_id,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    byteSize: row.byte_size,
    contentSha256: row.content_sha256,
    caption: row.caption ?? undefined,
    displayOrder: row.display_order,
    contentUrl: mediaContentUrl(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mediaContentUrl(id: string): string {
  return `/api/media/${encodeURIComponent(id)}/content`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

const selectVisitMediaSql = `SELECT id, visit_id, item_id, object_key,
  original_filename, content_type, byte_size, content_sha256, caption,
  display_order, created_at, updated_at FROM visit_media`;
