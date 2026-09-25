-- The legacy table remains intact for rollback. Owner-PoC and the future Route
-- Sidecar reserve billable units in this SKU-aware ledger before egress.
CREATE TABLE IF NOT EXISTS agent_provider_usage_by_sku (
  provider_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  period_start_utc TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  billable_units INTEGER NOT NULL DEFAULT 0 CHECK (billable_units >= 0),
  cost_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (cost_micro_usd >= 0),
  PRIMARY KEY (provider_id, sku, period_start_utc)
);

-- Preserve pre-upgrade counters without pretending that their historical
-- requests can be classified as either Geocoding or Matrix elements.
INSERT OR IGNORE INTO agent_provider_usage_by_sku (
  provider_id,
  sku,
  period_start_utc,
  request_count,
  billable_units,
  cost_micro_usd
)
SELECT
  provider_id,
  'legacy.requests',
  period_start_utc,
  request_count,
  request_count,
  cost_micro_usd
FROM agent_provider_usage;
