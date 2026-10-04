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

-- Fresh deployments start with an empty catalog. Existing applied migrations
-- and their saved records are unchanged; retain this legacy schema for upgrades.
