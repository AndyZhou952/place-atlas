-- Public media IDs must be independent of internal IDs and object keys. There
-- is no secret-backed deterministic derivation available in SQLite, so this
-- migration fails closed when legacy media exists instead of exposing it.
CREATE TABLE owner_poc_public_media_migration_gate_0005 (
  existing_rows INTEGER NOT NULL CHECK (existing_rows = 0)
);

INSERT INTO owner_poc_public_media_migration_gate_0005 (existing_rows)
SELECT COUNT(*) FROM visit_media;

DROP TABLE owner_poc_public_media_migration_gate_0005;

ALTER TABLE visit_media ADD COLUMN display_id TEXT;

CREATE UNIQUE INDEX idx_visit_media_display_id
  ON visit_media (display_id);

CREATE TRIGGER visit_media_display_id_required_insert
BEFORE INSERT ON visit_media
WHEN NEW.display_id IS NULL OR NEW.display_id = ''
BEGIN
  SELECT RAISE(ABORT, 'visit_media.display_id is required');
END;

CREATE TRIGGER visit_media_display_id_required_update
BEFORE UPDATE OF display_id ON visit_media
WHEN NEW.display_id IS NULL OR NEW.display_id = ''
BEGIN
  SELECT RAISE(ABORT, 'visit_media.display_id is required');
END;
