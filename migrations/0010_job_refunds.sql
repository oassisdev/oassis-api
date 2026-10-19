-- The cumulative refund checkpoint and its balance/ledger delta commit together.
-- Retrying an alarm, including after an uncertain D1 response, never credits twice.
CREATE TABLE job_refunds (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL REFERENCES accounts(id),
  micros INTEGER NOT NULL CHECK(micros >= 0),
  concept TEXT NOT NULL,
  reference TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TRIGGER job_refund_credit AFTER UPDATE OF micros ON job_refunds
WHEN NEW.micros > OLD.micros BEGIN
  UPDATE accounts SET balance_micros = balance_micros + NEW.micros - OLD.micros WHERE id = NEW.account;
  INSERT INTO transactions(account,at,micros,concept,reference)
  VALUES(NEW.account,NEW.at,NEW.micros - OLD.micros,NEW.concept,NEW.reference);
END;
