import { normalizeRating } from '../shared/text.ts';
import type {
  GoogleRating,
  Media,
  Restaurant,
  RestaurantPatch,
  Visit,
  VisitInput,
} from '../shared/types.ts';
import { HttpError } from './http.ts';
import type { AtlasItem } from './agent/add/stored-item.ts';
import { type StoredRow, toRestaurant } from './record.ts';

// Tables come from migrations/owner-poc. Their historical names are kept so existing
// databases upgrade without a data migration.

const RESTAURANT_SQL = `SELECT i.id, i.payload_json, i.created_at, i.updated_at,
    o.title AS override_title, o.description AS override_description,
    a.overall_rating, a.is_favorite, a.has_visited, a.summary,
    (SELECT COUNT(*) FROM visits v WHERE v.item_id = i.id) AS visit_count
  FROM atlas_items i
  LEFT JOIN atlas_item_overrides o ON o.item_id = i.id
  LEFT JOIN place_assessments a ON a.item_id = i.id
  WHERE i.verification_status = 'verified'
    AND i.id NOT IN (SELECT item_id FROM atlas_item_tombstones)`;

export async function listRestaurants(db: D1Database): Promise<Restaurant[]> {
  const { results } = await db
    .prepare(`${RESTAURANT_SQL} ORDER BY i.created_at DESC`)
    .all<StoredRow>();
  return results.flatMap((row) => toRestaurant(row) ?? []);
}

export async function getRestaurant(db: D1Database, id: string): Promise<Restaurant> {
  const row = await db.prepare(`${RESTAURANT_SQL} AND i.id = ?`).bind(id).first<StoredRow>();
  const restaurant = row && toRestaurant(row);
  if (!restaurant) throw new HttpError(404, 'Restaurant not found.');
  return restaurant;
}

/**
 * The stored payloads with Owner overrides and assessments applied, as the Add and Recommend
 * harnesses read them (the same rows `listRestaurants` accepts).
 */
export async function listCatalogItems(db: D1Database): Promise<AtlasItem[]> {
  const { results } = await db
    .prepare(`${RESTAURANT_SQL} ORDER BY i.created_at DESC, i.id ASC`)
    .all<StoredRow>();
  return results.flatMap((row) => {
    const restaurant = toRestaurant(row);
    if (!restaurant) return [];
    const payload = JSON.parse(row.payload_json) as AtlasItem;
    return [
      {
        ...payload,
        title: restaurant.title,
        description: restaurant.description,
        personalRating: typeof row.overall_rating === 'number' ? row.overall_rating : undefined,
        isFavorite: row.is_favorite === 1,
        hasVisited: row.has_visited === 1 || (row.visit_count ?? 0) > 0,
      },
    ];
  });
}

function assessmentUpsert(
  db: D1Database,
  id: string,
  current: Restaurant,
  patch: Pick<RestaurantPatch, 'rating' | 'favorite' | 'visited' | 'comment'>,
  manualVisited: boolean,
  now: string,
  /** Write only if this request just wrote the visit (its created_at or updated_at is `now`). */
  visit?: { readonly id: string; readonly stamp: 'created_at' | 'updated_at' },
) {
  const rating =
    patch.rating === undefined
      ? current.rating
      : patch.rating === null
        ? undefined
        : normalizeRating(patch.rating);
  const comment =
    patch.comment === undefined ? current.comment : patch.comment?.trim() || undefined;
  return db
    .prepare(
      `INSERT INTO place_assessments (item_id, overall_rating, is_favorite, has_visited, summary, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${
         visit
           ? `EXISTS (SELECT 1 FROM visits WHERE id = ? AND item_id = ? AND ${visit.stamp} = ?)`
           : 'true'
       }
       ON CONFLICT(item_id) DO UPDATE SET overall_rating = excluded.overall_rating,
         is_favorite = excluded.is_favorite, has_visited = excluded.has_visited,
         summary = excluded.summary, updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      rating ?? null,
      Number(patch.favorite ?? current.favorite),
      Number(patch.visited ?? manualVisited),
      comment ?? null,
      now,
      now,
      ...(visit ? [visit.id, id, now] : []),
    );
}

async function manualVisited(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT has_visited FROM place_assessments WHERE item_id = ?')
    .bind(id)
    .first<{ has_visited: number }>();
  return Boolean(row?.has_visited);
}

export async function updateRestaurant(
  db: D1Database,
  id: string,
  patch: RestaurantPatch,
): Promise<Restaurant> {
  const current = await getRestaurant(db, id);
  const now = new Date().toISOString();
  const statements = [assessmentUpsert(db, id, current, patch, await manualVisited(db, id), now)];
  if (patch.title !== undefined || patch.description !== undefined) {
    // Fold any 0.1 override into the payload so the record has one source of truth.
    statements.push(
      db
        .prepare(
          `UPDATE atlas_items SET payload_json = json_set(payload_json, '$.title', ?, '$.description', ?, '$.updatedAt', ?),
           updated_at = ? WHERE id = ?`,
        )
        .bind(patch.title ?? current.title, patch.description ?? current.description, now, now, id),
      db.prepare('DELETE FROM atlas_item_overrides WHERE item_id = ?').bind(id),
      // An open Add preview compares this revision before it publishes.
      db.prepare(
        'UPDATE atlas_catalog_revision SET revision_number = revision_number + 1 WHERE singleton = 1',
      ),
    );
  }
  await db.batch(statements);
  return getRestaurant(db, id);
}

const ITEM_TABLES = [
  'visit_media',
  'visits',
  'journal_entries',
  'place_assessments',
  'atlas_item_overrides',
  'atlas_item_location_snapshots',
  'atlas_item_tabelog_snapshots',
  'atlas_item_reservation_snapshots',
  'atlas_place_identities',
  'atlas_google_rating_references',
];

export async function deleteRestaurant(db: D1Database, media: R2Bucket, id: string): Promise<void> {
  const { results } = await db
    .prepare('SELECT object_key FROM visit_media WHERE item_id = ?')
    .bind(id)
    .all<{ object_key: string }>();
  await db.batch([
    ...ITEM_TABLES.map((table) => db.prepare(`DELETE FROM ${table} WHERE item_id = ?`).bind(id)),
    db.prepare('DELETE FROM atlas_review_candidates WHERE id = ?').bind(id),
    db.prepare('DELETE FROM atlas_items WHERE id = ?').bind(id),
    db
      .prepare(
        'INSERT INTO atlas_item_tombstones (item_id, deleted_at) VALUES (?, ?) ON CONFLICT(item_id) DO NOTHING',
      )
      .bind(id, new Date().toISOString()),
  ]);
  if (results.length) await media.delete(results.map((row) => row.object_key));
}

// Visits and media

interface VisitRow {
  readonly id: string;
  readonly item_id: string;
  readonly visited_at: string;
  readonly note: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface MediaRow {
  readonly display_id: string;
  readonly visit_id: string;
  readonly content_type: string;
  readonly caption: string | null;
}

const toMedia = (row: MediaRow): Media => ({
  id: row.display_id,
  visitId: row.visit_id,
  contentType: row.content_type,
  ...(row.caption ? { caption: row.caption } : {}),
  url: `/api/media/${encodeURIComponent(row.display_id)}/content`,
});

/** Visits and media of published restaurants only (verified, shown, not deleted). */
export async function listVisits(db: D1Database): Promise<Visit[]> {
  const published = new Set((await listRestaurants(db)).map(({ id }) => id));
  const [visits, media] = await db.batch<VisitRow | MediaRow>([
    db.prepare(
      'SELECT id, item_id, visited_at, note, created_at, updated_at FROM visits ORDER BY visited_at DESC, created_at DESC',
    ),
    db.prepare(
      'SELECT display_id, visit_id, content_type, caption FROM visit_media ORDER BY display_order, created_at',
    ),
  ]);
  const mediaByVisit = Map.groupBy(
    (media.results as MediaRow[]).map(toMedia),
    (entry) => entry.visitId,
  );
  return (visits.results as VisitRow[]).flatMap((row) =>
    published.has(row.item_id)
      ? [
          {
            id: row.id,
            restaurantId: row.item_id,
            visitedOn: row.visited_at,
            ...(row.note ? { note: row.note } : {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            media: mediaByVisit.get(row.id) ?? [],
          },
        ]
      : [],
  );
}

/** Creates the visit (idempotent by id) and, in the same batch, optionally its overall rating. */
export async function saveVisit(
  db: D1Database,
  id: string,
  input: VisitInput,
  create: boolean,
): Promise<void> {
  const restaurant = await getRestaurant(db, input.restaurantId);
  const now = new Date().toISOString();
  const statements = create
    ? [
        db
          .prepare(
            `INSERT INTO visits (id, item_id, item_title, visited_at, note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
          )
          .bind(id, restaurant.id, restaurant.title, input.visitedOn, input.note ?? null, now, now),
      ]
    : [
        db
          .prepare(
            'UPDATE visits SET item_id = ?, item_title = ?, visited_at = ?, note = ?, updated_at = ? WHERE id = ?',
          )
          .bind(restaurant.id, restaurant.title, input.visitedOn, input.note ?? null, now, id),
        db.prepare('UPDATE visit_media SET item_id = ? WHERE visit_id = ?').bind(restaurant.id, id),
      ];
  if (input.rating !== undefined) {
    statements.push(
      assessmentUpsert(
        db,
        restaurant.id,
        restaurant,
        { rating: input.rating },
        await manualVisited(db, restaurant.id),
        now,
        // A failed update or a replayed create must not change the current score.
        { id, stamp: create ? 'created_at' : 'updated_at' },
      ),
    );
  }
  const [result] = await db.batch(statements);
  if (!create && !result.meta.changes) throw new HttpError(404, 'Visit not found.');
}

export async function deleteVisit(db: D1Database, media: R2Bucket, id: string): Promise<void> {
  const { results } = await db
    .prepare('SELECT object_key FROM visit_media WHERE visit_id = ?')
    .bind(id)
    .all<{ object_key: string }>();
  await db.batch([
    db.prepare('DELETE FROM visit_media WHERE visit_id = ?').bind(id),
    db.prepare('DELETE FROM visits WHERE id = ?').bind(id),
    db.prepare('DELETE FROM journal_entries WHERE id = ?').bind(id),
  ]);
  if (results.length) await media.delete(results.map((row) => row.object_key));
}

const IMAGE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => ascii(b, 1, 4) === 'PNG' && b[0] === 0x89,
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  'image/gif': (b) => ['GIF87a', 'GIF89a'].includes(ascii(b, 0, 6)),
  'video/mp4': (b) => ascii(b, 4, 8) === 'ftyp',
  'video/webm': (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
};
const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.slice(start, end));
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export interface Upload {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Stores files in R2, then their rows in one batch. An upload id is a retry key: the same bytes for
 * the same visit return the stored media without writing again, and anything else under that id is
 * refused before any write. Each attempt writes objects under its own keys, so it only ever removes
 * its own objects: when it does not commit, or when an overlapping attempt committed that id first.
 */
export async function addMedia(
  db: D1Database,
  bucket: R2Bucket,
  visitId: string,
  uploads: readonly Upload[],
): Promise<Media[]> {
  const visit = await db
    .prepare(
      `SELECT v.item_id, COALESCE(MAX(m.display_order), -1) + 1 AS next_order
       FROM visits v LEFT JOIN visit_media m ON m.visit_id = v.id WHERE v.id = ? GROUP BY v.item_id`,
    )
    .bind(visitId)
    .first<{ item_id: string; next_order: number }>();
  if (!visit) throw new HttpError(404, 'Visit not found.');
  for (const upload of uploads) {
    const limit = upload.type.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (
      !IMAGE_SIGNATURES[upload.type]?.(upload.bytes) ||
      !upload.bytes.byteLength ||
      upload.bytes.byteLength > limit
    ) {
      throw new HttpError(
        400,
        `${upload.name} is not a supported photo (8 MB) or MP4/WebM video (50 MB).`,
      );
    }
  }
  const files = await Promise.all(
    uploads.map(async (upload, index) => {
      const digest = await crypto.subtle.digest('SHA-256', upload.bytes);
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      // A key per attempt: no other request ever writes, or removes, this object.
      const objectKey = `visits/${visitId}/${upload.id}/${crypto.randomUUID()}`;
      return { upload, index, sha256, objectKey };
    }),
  );
  const sameFile = (row: StoredUpload | undefined, file: (typeof files)[number]) =>
    row?.visit_id === visitId &&
    row.content_sha256 === file.sha256 &&
    row.content_type === file.upload.type &&
    row.byte_size === file.upload.bytes.byteLength;
  const conflict = () =>
    new HttpError(409, 'This upload id already holds a different file; upload it again.');
  const stored = await storedUploads(db, uploads);
  if (
    files.some((file) => stored.has(file.upload.id) && !sameFile(stored.get(file.upload.id), file))
  )
    throw conflict();
  const fresh = files.filter((file) => !stored.has(file.upload.id));

  const written: string[] = [];
  const removeUnreferenced = async () => {
    if (!written.length) return;
    const { results } = await db
      .prepare(
        `SELECT object_key FROM visit_media WHERE object_key IN (${written.map(() => '?').join(',')})`,
      )
      .bind(...written)
      .all<{ object_key: string }>();
    const referenced = new Set(results.map((row) => row.object_key));
    await Promise.allSettled(
      written.filter((key) => !referenced.has(key)).map((key) => bucket.delete(key)),
    );
  };
  const now = new Date().toISOString();
  try {
    const puts = await Promise.allSettled(
      fresh.map(async ({ upload, objectKey }) => {
        await bucket.put(objectKey, upload.bytes, { httpMetadata: { contentType: upload.type } });
        written.push(objectKey);
      }),
    );
    const failed = puts.find((put) => put.status === 'rejected');
    if (failed) throw failed.reason;
    if (fresh.length)
      await db.batch(
        fresh.map(({ upload, index, sha256, objectKey }) =>
          db
            .prepare(
              `INSERT INTO visit_media (id, display_id, visit_id, item_id, object_key, original_filename, content_type,
                 byte_size, content_sha256, caption, display_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
            )
            .bind(
              upload.id,
              `pm_${crypto.randomUUID()}`,
              visitId,
              visit.item_id,
              objectKey,
              upload.name.slice(0, 200) || 'media',
              upload.type,
              upload.bytes.byteLength,
              sha256,
              visit.next_order + index,
              now,
              now,
            ),
        ),
      );
  } catch (error) {
    await removeUnreferenced();
    throw error;
  }
  // An overlapping attempt can commit an id first. This attempt's object is then unreferenced; the
  // same file reuses that row, and another file is refused.
  const committed = await storedUploads(db, uploads);
  const lost = fresh.filter((file) => committed.get(file.upload.id)?.object_key !== file.objectKey);
  if (lost.length) {
    await removeUnreferenced();
    if (lost.some((file) => !sameFile(committed.get(file.upload.id), file))) throw conflict();
  }
  const placeholders = uploads.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT display_id, visit_id, content_type, caption FROM visit_media WHERE id IN (${placeholders}) ORDER BY display_order`,
    )
    .bind(...uploads.map((upload) => upload.id))
    .all<MediaRow>();
  return results.map(toMedia);
}

interface StoredUpload {
  readonly id: string;
  readonly visit_id: string;
  readonly object_key: string;
  readonly content_type: string;
  readonly byte_size: number;
  readonly content_sha256: string;
}

async function storedUploads(db: D1Database, uploads: readonly Upload[]) {
  const { results } = await db
    .prepare(
      `SELECT id, visit_id, object_key, content_type, byte_size, content_sha256 FROM visit_media
       WHERE id IN (${uploads.map(() => '?').join(',')})`,
    )
    .bind(...uploads.map((upload) => upload.id))
    .all<StoredUpload>();
  return new Map(results.map((row) => [row.id, row]));
}

export async function updateMediaCaption(
  db: D1Database,
  displayId: string,
  caption?: string,
): Promise<void> {
  const result = await db
    .prepare('UPDATE visit_media SET caption = ?, updated_at = ? WHERE display_id = ?')
    .bind(caption ?? null, new Date().toISOString(), displayId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'Media not found.');
}

export async function deleteMedia(
  db: D1Database,
  bucket: R2Bucket,
  displayId: string,
): Promise<void> {
  const row = await db
    .prepare('DELETE FROM visit_media WHERE display_id = ? RETURNING object_key')
    .bind(displayId)
    .first<{ object_key: string }>();
  if (row) await bucket.delete(row.object_key);
}

export async function openMedia(
  db: D1Database,
  bucket: R2Bucket,
  displayId: string,
): Promise<Response> {
  const row = await db
    .prepare(
      `SELECT m.object_key, m.content_type, v.item_id FROM visit_media m
       JOIN visits v ON v.id = m.visit_id WHERE m.display_id = ?`,
    )
    .bind(displayId)
    .first<{ object_key: string; content_type: string; item_id: string }>();
  // Media is public only while its restaurant is published.
  const published = row ? await getRestaurant(db, row.item_id).then(Boolean, () => false) : false;
  const object =
    row && published && IMAGE_SIGNATURES[row.content_type]
      ? await bucket.get(row.object_key)
      : null;
  if (!row || !object) return new Response('Not found', { status: 404 });
  return new Response(object.body, {
    headers: {
      'content-type': row.content_type,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      etag: object.httpEtag,
    },
  });
}

// Owner-only Google rating references (Google Maps content is not published).

export async function listGoogleRatings(db: D1Database): Promise<Record<string, GoogleRating>> {
  const { results } = await db
    .prepare('SELECT item_id, reference_json FROM atlas_google_rating_references')
    .all<{
      item_id: string;
      reference_json: string;
    }>();
  return Object.fromEntries(
    results.map((row) => {
      const { score, reviewCount, url, observedAt } = JSON.parse(
        row.reference_json,
      ) as GoogleRating;
      return [
        row.item_id,
        { score, ...(reviewCount === undefined ? {} : { reviewCount }), url, observedAt },
      ];
    }),
  );
}

export async function saveGoogleRating(
  db: D1Database,
  itemId: string,
  placeId: string,
  rating: GoogleRating,
) {
  const now = new Date().toISOString();
  const reference = { itemId, placeId, ...rating, capturedAt: now, source: 'google_places_api' };
  await db
    .prepare(
      `INSERT INTO atlas_google_rating_references (item_id, reference_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET reference_json = excluded.reference_json, updated_at = excluded.updated_at`,
    )
    .bind(itemId, JSON.stringify(reference), now)
    .run();
}
