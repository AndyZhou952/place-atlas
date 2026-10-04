-- Additive T-13 CatalogIntake session state. Google presentation content is
-- request-scoped and must never enter these tables.

CREATE TABLE IF NOT EXISTS catalog_intake_request_tokens (
  owner_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  request_token TEXT NOT NULL,
  normalized_owner_query TEXT NOT NULL,
  session_id TEXT NOT NULL,
  retain_until_ms INTEGER NOT NULL,
  PRIMARY KEY (owner_id, channel, conversation_id, request_token)
);

CREATE TABLE IF NOT EXISTS catalog_intake_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('discovering', 'candidates_ready', 'preview_ready')
  ),
  session_version INTEGER NOT NULL CHECK (session_version > 0),
  request_token TEXT NOT NULL,
  normalized_owner_query TEXT NOT NULL,
  session_json TEXT NOT NULL CHECK (json_valid(session_json)),
  last_accepted_activity_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_intake_one_active_conversation
  ON catalog_intake_sessions (owner_id, channel, conversation_id);

CREATE INDEX IF NOT EXISTS idx_catalog_intake_session_expiry
  ON catalog_intake_sessions (expires_at_ms);

CREATE TABLE IF NOT EXISTS catalog_intake_terminal_refs (
  session_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('committed', 'cancelled', 'expired')
  ),
  session_version INTEGER NOT NULL CHECK (session_version > 0),
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  request_token TEXT NOT NULL,
  normalized_owner_query TEXT NOT NULL,
  terminal_at_ms INTEGER NOT NULL,
  retain_until_ms INTEGER NOT NULL,
  terminal_json TEXT NOT NULL CHECK (json_valid(terminal_json))
);

CREATE INDEX IF NOT EXISTS idx_catalog_intake_terminal_retention
  ON catalog_intake_terminal_refs (retain_until_ms);
