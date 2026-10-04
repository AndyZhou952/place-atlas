CREATE TABLE atlas_google_rating_references (
  item_id TEXT PRIMARY KEY NOT NULL,
  reference_json TEXT NOT NULL CHECK (json_valid(reference_json)),
  updated_at TEXT NOT NULL
);

ALTER TABLE catalog_intake_sessions ADD COLUMN google_rating_reference_json TEXT
  CHECK (google_rating_reference_json IS NULL OR json_valid(google_rating_reference_json));
