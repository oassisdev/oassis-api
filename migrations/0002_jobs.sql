-- Batch jobs: who owns each one, so collecting it is not open to whoever guesses an
-- id. The results themselves live in the job's Durable Object, not here: this table
-- is identity and money, like the rest of the database.

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  account         TEXT,
  gate            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  urls            INTEGER NOT NULL,
  charged_micros  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jobs_by_account ON jobs(account, created_at);
