-- Additive T-16 Atlas Catalog publication state. A publish adapter writes
-- identity, item, optional snapshots, receipt, and terminal session in one
-- D1 batch transaction. Receipts and terminal references are retained for
-- response-loss recovery without retaining transient provider content.

CREATE TABLE IF NOT EXISTS atlas_catalog_revision (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0)
);

INSERT OR IGNORE INTO atlas_catalog_revision (singleton, revision_number)
VALUES (1, 1);

CREATE TABLE IF NOT EXISTS atlas_place_identities (
  provider_namespace TEXT NOT NULL,
  place_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_by_mutation_key TEXT NOT NULL CHECK (
    length(created_by_mutation_key) = 64
  ),
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider_namespace, place_id),
  UNIQUE (item_id)
);

CREATE TABLE IF NOT EXISTS atlas_review_candidates (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS atlas_item_tabelog_snapshots (
  item_id TEXT PRIMARY KEY NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS atlas_item_location_snapshots (
  item_id TEXT PRIMARY KEY NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS atlas_item_reservation_snapshots (
  item_id TEXT PRIMARY KEY NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  updated_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_intake_publish_receipts (
  mutation_key TEXT PRIMARY KEY NOT NULL CHECK (length(mutation_key) = 64),
  session_id TEXT NOT NULL,
  preview_version INTEGER NOT NULL CHECK (preview_version > 0),
  preview_digest TEXT NOT NULL CHECK (length(preview_digest) = 64),
  source_session_version INTEGER NOT NULL CHECK (source_session_version > 0),
  catalog_revision TEXT NOT NULL,
  claim_attempt_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  outcome_json TEXT NOT NULL CHECK (json_valid(outcome_json)),
  committed_at_ms INTEGER NOT NULL,
  retain_until_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_intake_publish_receipt_retention
  ON catalog_intake_publish_receipts (retain_until_ms);

CREATE TABLE IF NOT EXISTS catalog_intake_publish_claims (
  mutation_key TEXT PRIMARY KEY NOT NULL CHECK (length(mutation_key) = 64),
  claim_attempt_id TEXT NOT NULL
);
