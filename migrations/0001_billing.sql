-- Accounts, API keys and transactions. All money in micro-dollars (integers).

CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  balance_micros  INTEGER NOT NULL DEFAULT 0,
  -- Concurrent browser sessions. Each one is a browser being billed.
  max_sessions    INTEGER NOT NULL DEFAULT 3,
  active          INTEGER NOT NULL DEFAULT 1,
  note            TEXT
);

-- Only the hash of a key is stored: whoever reads this table does not walk away
-- with working keys. The prefix is so its owner can recognise it.
CREATE TABLE IF NOT EXISTS api_keys (
  hash        TEXT PRIMARY KEY,
  account     TEXT NOT NULL REFERENCES accounts(id),
  prefix      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER
);
CREATE INDEX IF NOT EXISTS api_keys_by_account ON api_keys(account);

-- Every charge and every top-up, so a balance can always be explained. Same name as
-- the route that serves it: /account/transactions.
CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account     TEXT NOT NULL,
  at          INTEGER NOT NULL,
  -- Negative = charge, positive = top-up.
  micros      INTEGER NOT NULL,
  concept     TEXT NOT NULL,
  route       TEXT,
  reference   TEXT
);
CREATE INDEX IF NOT EXISTS transactions_by_account ON transactions(account, at);

-- Browser sessions: they drive the concurrency limit and the time billed on close.
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  account         TEXT,
  gate            TEXT NOT NULL,
  opened_at       INTEGER NOT NULL,
  closed_at       INTEGER,
  charged_micros  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_open ON sessions(account, closed_at);
