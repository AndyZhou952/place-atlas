-- Existing media have no per-item score; do not copy the place's overall score.
ALTER TABLE visit_media ADD COLUMN score REAL CHECK (score IS NULL OR (score >= 0 AND score <= 5));
