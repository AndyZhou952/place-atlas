-- Additive T-15 single-intake research phase ledger. D1 consumes a phase
-- before relay egress; spent allowances are never refunded or reused.

CREATE TABLE IF NOT EXISTS catalog_intake_research_phase_spends (
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('initial', 'confirm')),
  query_or_urls_digest TEXT NOT NULL CHECK (
    length(query_or_urls_digest) = 64
  ),
  request_id TEXT NOT NULL UNIQUE CHECK (length(request_id) BETWEEN 1 AND 200),
  max_search_queries INTEGER NOT NULL,
  max_page_requests INTEGER NOT NULL,
  max_duration_ms INTEGER NOT NULL,
  request_timeout_ms INTEGER NOT NULL CHECK (request_timeout_ms = 15000),
  max_redirects INTEGER NOT NULL CHECK (max_redirects = 3),
  spent_at_ms INTEGER NOT NULL,
  deadline_ms INTEGER NOT NULL,
  retain_until_ms INTEGER NOT NULL,
  PRIMARY KEY (session_id, phase),
  CHECK (
    (phase = 'initial' AND max_search_queries = 1 AND
      max_page_requests = 3 AND max_duration_ms = 35000) OR
    (phase = 'confirm' AND max_search_queries = 0 AND
      max_page_requests = 2 AND max_duration_ms = 25000)
  )
);

CREATE INDEX IF NOT EXISTS idx_catalog_intake_research_spend_retention
  ON catalog_intake_research_phase_spends (retain_until_ms);
