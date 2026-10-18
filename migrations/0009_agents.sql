-- Free agent services: one row per configured service, and the last read of each target
-- so the next run can say what changed.
CREATE TABLE agent_services (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  agent TEXT NOT NULL,
  config TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  frequency TEXT NOT NULL,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_report TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX agent_services_due ON agent_services(status, next_run_at);
CREATE INDEX agent_services_account ON agent_services(account, status);

CREATE TABLE agent_snapshots (
  service TEXT NOT NULL,
  target TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  hash TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (service, target)
);
