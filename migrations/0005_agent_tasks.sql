-- Agent tasks: a natural-language request run over public pages, paid from a balance that
-- is reserved when the task starts. Money is in micro-dollars, as everywhere else.

-- Reserved balance: money promised to running tasks. Every charge must leave it intact.
ALTER TABLE accounts ADD COLUMN reserved_micros INTEGER NOT NULL DEFAULT 0;

-- One hold per task. The hold is what the reservation counts; state moves held -> settled once.
CREATE TABLE IF NOT EXISTS agent_holds (
  task_id   TEXT PRIMARY KEY,
  account   TEXT NOT NULL REFERENCES accounts(id),
  micros    INTEGER NOT NULL,
  state     TEXT NOT NULL CHECK (state IN ('held', 'settled'))
);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id              TEXT PRIMARY KEY,
  account         TEXT NOT NULL REFERENCES accounts(id),
  status          TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  mode            TEXT NOT NULL,
  request         TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  idempotency_key TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  reserved_micros INTEGER NOT NULL,
  spent_micros    INTEGER NOT NULL DEFAULT 0,
  released_micros INTEGER NOT NULL DEFAULT 0,
  settlement      TEXT NOT NULL DEFAULT 'pending' CHECK (settlement IN ('pending', 'settled')),
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  -- The task document: progress, operations, sources, result and limitations. Written at each step.
  document        TEXT NOT NULL,
  error_code      TEXT,
  error_message   TEXT
);
-- Same key, same account, same task. A key is never shared between accounts.
CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_idempotency
  ON agent_tasks(account, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_tasks_by_account ON agent_tasks(account, created_at);
