-- A short operational log: what was called, what came back, and how long it took.
--
-- The previous project kept one of these without a ceiling and it grew to 567 MB and a
-- bill. This one is capped by row count and pruned on write, and the bodies are stored
-- truncated — enough to see what a caller asked for, not a copy of the web.
CREATE TABLE IF NOT EXISTS traces (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  -- 'mcp' or 'http': the door the call came through.
  channel      TEXT    NOT NULL,
  method       TEXT    NOT NULL,
  path         TEXT    NOT NULL,
  tool         TEXT,
  status       INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  ip           TEXT,
  country      TEXT,
  client       TEXT,
  -- The paying wallet, when the call was paid on-chain.
  wallet       TEXT,
  account      TEXT,
  req_body     TEXT,
  resp_body    TEXT
);

CREATE INDEX IF NOT EXISTS traces_at ON traces (at DESC);
