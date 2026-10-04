CREATE TABLE IF NOT EXISTS agent_provider_usage (
  provider_id TEXT NOT NULL,
  period_start_utc TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  cost_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
  PRIMARY KEY (provider_id, period_start_utc)
);
