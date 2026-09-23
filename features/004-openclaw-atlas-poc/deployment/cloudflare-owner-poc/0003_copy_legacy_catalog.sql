-- atlas_items is the owner-PoC catalog source of truth. Keep the legacy Agent
-- table intact for rollback, and never overwrite an owner-created or already
-- migrated canonical record when this migration is replayed.
INSERT OR IGNORE INTO atlas_items (
  id,
  payload_json,
  verification_status,
  created_at,
  updated_at
)
SELECT
  id,
  payload_json,
  verification_status,
  created_at,
  updated_at
FROM agent_catalog_items;
