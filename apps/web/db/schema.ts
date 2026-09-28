import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const atlasItems = sqliteTable(
  'atlas_items',
  {
    id: text('id').primaryKey(),
    payloadJson: text('payload_json').notNull(),
    verificationStatus: text('verification_status').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_atlas_items_verification_status').on(table.verificationStatus),
  ],
);

export const atlasItemOverrides = sqliteTable('atlas_item_overrides', {
  itemId: text('item_id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  personalState: text('personal_state').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const placeAssessments = sqliteTable('place_assessments', {
  itemId: text('item_id').primaryKey(),
  overallRating: real('overall_rating'),
  isFavorite: integer('is_favorite', { mode: 'boolean' })
    .notNull()
    .default(false),
  hasVisited: integer('has_visited', { mode: 'boolean' })
    .notNull()
    .default(false),
  summary: text('summary'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const atlasItemTombstones = sqliteTable('atlas_item_tombstones', {
  itemId: text('item_id').primaryKey(),
  deletedAt: text('deleted_at').notNull(),
});

export const visits = sqliteTable(
  'visits',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull(),
    itemTitle: text('item_title').notNull(),
    visitedAt: text('visited_at').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_visits_item_visited').on(table.itemId, table.visitedAt),
  ],
);

export const visitMedia = sqliteTable(
  'visit_media',
  {
    id: text('id').primaryKey(),
    visitId: text('visit_id').notNull(),
    itemId: text('item_id').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    contentSha256: text('content_sha256').notNull(),
    caption: text('caption'),
    score: real('score'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_visit_media_object_key').on(table.objectKey),
    index('idx_visit_media_visit_order').on(table.visitId, table.displayOrder),
    index('idx_visit_media_item_created').on(table.itemId, table.createdAt),
  ],
);

export const importJobs = sqliteTable(
  'import_jobs',
  {
    id: text('id').primaryKey(),
    sourceRef: text('source_ref').notNull(),
    creatorName: text('creator_name').notNull(),
    platform: text('platform').notNull(),
    status: text('status').notNull(),
    discoveredCount: integer('discovered_count').notNull().default(0),
    needsReviewCount: integer('needs_review_count').notNull().default(0),
    message: text('message'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_import_jobs_status_created_at').on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id').notNull(),
    itemTitle: text('item_title').notNull(),
    visitedAt: text('visited_at').notNull(),
    rating: real('rating').notNull(),
    note: text('note').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_journal_entries_item_visited').on(table.itemId, table.visitedAt),
  ],
);
