CREATE TABLE agent_gateway_nonces (
  project_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  retain_until_ms INTEGER NOT NULL,
  PRIMARY KEY (project_id, key_id, nonce)
);

CREATE TABLE agent_gateway_receipts (
  project_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (project_id, mutation_id)
);

CREATE TABLE agent_gateway_audit (
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

CREATE TABLE agent_nearby_fixtures (
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

INSERT INTO agent_nearby_fixtures (
  fixture_set,
  fixture_rank,
  resolved_location,
  item_id,
  name,
  area,
  address,
  walking_minutes,
  visited,
  reason,
  map_deep_link
) VALUES (
  'readonly-default',
  1,
  '东京都中央区银座',
  'fixture-sushi-1',
  'Fixture Sushi 银座',
  '银座',
  '东京都中央区银座 1-2-3',
  8,
  0,
  '步行可达，而且你还没去过',
  'https://fixture.invalid/items/fixture-sushi-1'
);
