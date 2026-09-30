-- What clients tell us went wrong. The only channel a paying agent has to report a bad
-- result, so it is free to use and kept next to the account that sent it.

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account    TEXT,
  at         INTEGER NOT NULL,
  -- "good" or "bad": the one field worth aggregating.
  verdict    TEXT NOT NULL,
  -- The route the feedback is about, and the job or session it happened on.
  route      TEXT,
  reference  TEXT,
  url        TEXT,
  comment    TEXT
);
CREATE INDEX IF NOT EXISTS feedback_by_account ON feedback(account, at);
CREATE INDEX IF NOT EXISTS feedback_by_verdict ON feedback(verdict, at);
