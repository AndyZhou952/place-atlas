export const insertVisitSql = `INSERT INTO visits
  (id, item_id, item_title, visited_at, note, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING`;

export const upsertVisitedWithoutRatingSql = `INSERT INTO place_assessments
  (item_id, overall_rating, is_favorite, has_visited, summary, created_at, updated_at)
  VALUES (?, NULL, 0, 1, NULL, ?, ?)
  ON CONFLICT(item_id) DO UPDATE SET
    has_visited = 1,
    updated_at = excluded.updated_at`;

export const upsertVisitedWithRatingSql = `INSERT INTO place_assessments
  (item_id, overall_rating, is_favorite, has_visited, summary, created_at, updated_at)
  VALUES (?, ?, 0, 1, NULL, ?, ?)
  ON CONFLICT(item_id) DO UPDATE SET
    overall_rating = excluded.overall_rating,
    has_visited = 1,
    updated_at = excluded.updated_at`;

export const journalCreatePerformanceBudget = {
  bindingRoundTrips: 2,
  statements: 3,
  fullTableReads: 0,
} as const;
