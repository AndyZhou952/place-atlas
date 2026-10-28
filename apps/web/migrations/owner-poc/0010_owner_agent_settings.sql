-- Model credentials are encrypted using a server-only key before persistence.
CREATE TABLE IF NOT EXISTS owner_agent_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  ciphertext TEXT NOT NULL
);
