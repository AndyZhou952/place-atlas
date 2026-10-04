-- Additive owner-PoC schema. This file is intentionally idempotent so it may
-- initialize an empty blue-green D1 database or extend a restored read-only
-- Agent fixture export without deleting legacy evidence.

CREATE TABLE IF NOT EXISTS agent_gateway_nonces (
  project_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  retain_until_ms INTEGER NOT NULL,
  PRIMARY KEY (project_id, key_id, nonce)
);

CREATE TABLE IF NOT EXISTS agent_gateway_receipts (
  project_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (project_id, mutation_id)
);

CREATE TABLE IF NOT EXISTS agent_gateway_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  result_kind TEXT NOT NULL,
  replayed INTEGER NOT NULL CHECK (replayed IN (0, 1)),
  duration_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS atlas_mutation_claims (
  principal TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
  attempt_token TEXT NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('claimed', 'committed')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (principal, mutation_id)
);

CREATE TABLE IF NOT EXISTS atlas_mutation_receipts (
  principal TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK (length(payload_digest) = 64),
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  committed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (principal, mutation_id),
  FOREIGN KEY (principal, mutation_id)
    REFERENCES atlas_mutation_claims(principal, mutation_id)
);

CREATE TABLE IF NOT EXISTS agent_nearby_fixtures (
  fixture_set TEXT NOT NULL,
  fixture_rank INTEGER NOT NULL,
  resolved_location TEXT NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  address TEXT NOT NULL,
  walking_minutes INTEGER NOT NULL,
  visited INTEGER NOT NULL CHECK (visited IN (0, 1)),
  reason TEXT NOT NULL,
  map_deep_link TEXT NOT NULL,
  PRIMARY KEY (fixture_set, item_id)
);

CREATE TABLE IF NOT EXISTS agent_catalog_items (
  id TEXT PRIMARY KEY CHECK (id IS json_extract(payload_json, '$.id')),
  kind TEXT NOT NULL CHECK (
    kind IN ('food', 'event', 'architecture')
    AND kind IS json_extract(payload_json, '$.kind')
  ),
  verification_status TEXT NOT NULL CHECK (
    verification_status IN ('verified', 'needs_review')
    AND verification_status IS json_extract(payload_json, '$.verificationStatus')
  ),
  latitude REAL NOT NULL CHECK (
    latitude >= -90
    AND latitude <= 90
    AND latitude IS json_extract(payload_json, '$.latitude')
  ),
  longitude REAL NOT NULL CHECK (
    longitude >= -180
    AND longitude <= 180
    AND longitude IS json_extract(payload_json, '$.longitude')
  ),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  record_origin TEXT NOT NULL DEFAULT 'catalog_intake' CHECK (
    record_origin IN ('repo_seed', 'catalog_intake')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_catalog_items_nearby_idx
  ON agent_catalog_items (
    verification_status,
    kind,
    latitude,
    longitude
  );

CREATE TABLE IF NOT EXISTS agent_provider_usage (
  provider_id TEXT NOT NULL,
  period_start_utc TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  cost_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
  PRIMARY KEY (provider_id, period_start_utc)
);

CREATE TABLE IF NOT EXISTS owner_poc_seed_manifests (
  seed_version TEXT PRIMARY KEY NOT NULL,
  source_artifact TEXT NOT NULL,
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
  payload_aggregate_sha256 TEXT NOT NULL CHECK (
    length(payload_aggregate_sha256) = 64
  ),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_poc_seed_manifest_records (
  seed_version TEXT NOT NULL,
  item_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  PRIMARY KEY (seed_version, item_id),
  FOREIGN KEY (seed_version)
    REFERENCES owner_poc_seed_manifests(seed_version)
);

CREATE TABLE IF NOT EXISTS atlas_item_overrides (
  item_id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  personal_state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS atlas_items (
  id TEXT PRIMARY KEY NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  verification_status TEXT NOT NULL CHECK (
    verification_status IN ('verified', 'needs_review')
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_atlas_items_verification_status
  ON atlas_items (verification_status);

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  source_ref TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  discovered_count INTEGER DEFAULT 0 NOT NULL,
  needs_review_count INTEGER DEFAULT 0 NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status_created_at
  ON import_jobs (status, created_at);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL,
  item_title TEXT NOT NULL,
  visited_at TEXT NOT NULL,
  rating REAL NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_item_visited
  ON journal_entries (item_id, visited_at);

CREATE TABLE IF NOT EXISTS atlas_item_tombstones (
  item_id TEXT PRIMARY KEY NOT NULL,
  deleted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS place_assessments (
  item_id TEXT PRIMARY KEY NOT NULL,
  overall_rating REAL,
  is_favorite INTEGER DEFAULT 0 NOT NULL CHECK (is_favorite IN (0, 1)),
  has_visited INTEGER DEFAULT 0 NOT NULL CHECK (has_visited IN (0, 1)),
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL,
  item_title TEXT NOT NULL,
  visited_at TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visits_item_visited
  ON visits (item_id, visited_at);

CREATE TABLE IF NOT EXISTS visit_media (
  id TEXT PRIMARY KEY NOT NULL,
  visit_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  caption TEXT,
  display_order INTEGER DEFAULT 0 NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_visit_media_object_key
  ON visit_media (object_key);
CREATE INDEX IF NOT EXISTS idx_visit_media_visit_order
  ON visit_media (visit_id, display_order);
CREATE INDEX IF NOT EXISTS idx_visit_media_item_created
  ON visit_media (item_id, created_at);

CREATE TABLE IF NOT EXISTS maintenance_control (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  mode TEXT NOT NULL,
  maintenance_id TEXT,
  writer_generation TEXT NOT NULL,
  write_revision INTEGER DEFAULT 0 NOT NULL
);

INSERT OR IGNORE INTO maintenance_control (
  id, mode, maintenance_id, writer_generation, write_revision
) VALUES (1, 'normal', NULL, 'unattested', 0);

CREATE TABLE IF NOT EXISTS maintenance_write_leases (
  lease_id TEXT PRIMARY KEY NOT NULL,
  maintenance_id TEXT,
  operation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolution TEXT
);

CREATE INDEX IF NOT EXISTS idx_maintenance_write_leases_expiry
  ON maintenance_write_leases (expires_at);

CREATE TABLE IF NOT EXISTS maintenance_confirmations (
  confirmation_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  maintenance_id TEXT NOT NULL,
  action TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  target_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_maintenance_confirmations_expiry
  ON maintenance_confirmations (expires_at);

CREATE TABLE IF NOT EXISTS maintenance_restore_runs (
  operation_id TEXT PRIMARY KEY NOT NULL,
  maintenance_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  target_digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS maintenance_restore_chunks (
  operation_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_bytes BLOB NOT NULL,
  chunk_digest TEXT NOT NULL,
  sealed_at TEXT,
  PRIMARY KEY (operation_id, chunk_index)
);

PRAGMA optimize;
