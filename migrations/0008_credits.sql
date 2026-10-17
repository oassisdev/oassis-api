-- Preserve existing money: credit units are a presentation over micro-dollars.
ALTER TABLE site_billing ADD COLUMN welcome_granted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_billing ADD COLUMN alert_baseline INTEGER NOT NULL DEFAULT 2000000;
ALTER TABLE site_billing ADD COLUMN alert_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE site_billing ADD COLUMN alert_cycle INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN label TEXT NOT NULL DEFAULT 'API key';
CREATE TABLE mcp_trials(identity TEXT PRIMARY KEY, spent_micros INTEGER NOT NULL DEFAULT 0 CHECK(spent_micros>=0), created_at INTEGER NOT NULL);
CREATE TABLE credit_notices(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, emailed_at INTEGER);
CREATE INDEX credit_notices_user ON credit_notices(user_id,at);
CREATE TABLE credit_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES site_billing(user_id),cents INTEGER NOT NULL CHECK(cents IN (500,2000,5000)),stripe_id TEXT UNIQUE,state TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,cancel_at_period_end INTEGER NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX credit_subscription_active ON credit_subscriptions(user_id) WHERE state IN ('pending','active','trialing','past_due','unpaid');
CREATE TRIGGER welcome_credits AFTER UPDATE OF welcome_granted ON site_billing WHEN OLD.welcome_granted=0 AND NEW.welcome_granted=1 BEGIN
 UPDATE accounts SET balance_micros=balance_micros+2000000 WHERE id=NEW.account_id;
 INSERT INTO transactions(account,at,micros,concept,reference) VALUES(NEW.account_id,unixepoch()*1000,2000000,'1,000 welcome credits',NEW.user_id);
END;
CREATE TRIGGER credit_alert_reset AFTER UPDATE OF state ON billing_orders WHEN NEW.state='paid' AND OLD.state!='paid' BEGIN
 UPDATE site_billing SET alert_baseline=MAX(0,(SELECT balance_micros-reserved_micros FROM accounts WHERE id=account_id)),alert_level=0,alert_cycle=alert_cycle+1 WHERE user_id=NEW.user_id;
END;
-- Stop the previous low-balance auto-charge mode; monthly purchases need new consent.
UPDATE site_billing SET auto_enabled=0;
