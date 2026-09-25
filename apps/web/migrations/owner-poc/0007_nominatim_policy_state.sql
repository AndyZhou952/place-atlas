-- T-14 application-wide Nominatim policy state. The rate row coordinates all
-- Worker isolates; the cache stores only closed durable geocoder proposals.

CREATE TABLE IF NOT EXISTS catalog_intake_nominatim_rate_gate (
  provider_id TEXT PRIMARY KEY NOT NULL,
  next_allowed_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_intake_nominatim_cache (
  provider_id TEXT NOT NULL,
  query_key TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  cached_at_ms INTEGER NOT NULL,
  PRIMARY KEY (provider_id, query_key)
);
