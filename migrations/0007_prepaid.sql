-- Dollar-denominated prepaid balance. No customer payment credentials are stored locally.
CREATE TABLE site_billing (
 user_id TEXT PRIMARY KEY REFERENCES site_user(id), account_id TEXT NOT NULL UNIQUE,
 customer TEXT UNIQUE, payment_method TEXT, auto_enabled INTEGER NOT NULL DEFAULT 0,
 auto_cents INTEGER NOT NULL DEFAULT 500, threshold_cents INTEGER NOT NULL DEFAULT 100,
 monthly_cap_cents INTEGER NOT NULL DEFAULT 2000
);
CREATE TABLE billing_orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES site_billing(user_id),
 cents INTEGER NOT NULL CHECK(cents IN (500,2000,5000)), created_at INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('manual','auto')), save_card INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'pending', payment_intent TEXT UNIQUE, invoice_id TEXT UNIQUE, invoice_url TEXT, invoice_pdf TEXT
);
CREATE INDEX billing_orders_user ON billing_orders(user_id,created_at);
CREATE TRIGGER billing_credit AFTER UPDATE OF state ON billing_orders
 WHEN NEW.state='paid' AND OLD.state!='paid' BEGIN
 UPDATE accounts SET balance_micros=balance_micros+NEW.cents*10000 WHERE id=(SELECT account_id FROM site_billing WHERE user_id=NEW.user_id);
 INSERT INTO transactions(account,at,micros,concept,reference)
 SELECT account_id,NEW.created_at,NEW.cents*10000,'Stripe top-up',NEW.id FROM site_billing WHERE user_id=NEW.user_id;
END;
CREATE TABLE billing_refunds (payment_intent TEXT PRIMARY KEY, user_id TEXT NOT NULL, cents INTEGER NOT NULL, at INTEGER NOT NULL);
CREATE TRIGGER billing_refund_new AFTER INSERT ON billing_refunds BEGIN
 UPDATE accounts SET balance_micros=balance_micros-NEW.cents*10000 WHERE id=(SELECT account_id FROM site_billing WHERE user_id=NEW.user_id);
 INSERT INTO transactions(account,at,micros,concept,reference) SELECT account_id,NEW.at,-NEW.cents*10000,'Card refund / dispute',NEW.payment_intent FROM site_billing WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER billing_refund_more AFTER UPDATE OF cents ON billing_refunds WHEN NEW.cents>OLD.cents BEGIN
 UPDATE accounts SET balance_micros=balance_micros-(NEW.cents-OLD.cents)*10000 WHERE id=(SELECT account_id FROM site_billing WHERE user_id=NEW.user_id);
 INSERT INTO transactions(account,at,micros,concept,reference) SELECT account_id,NEW.at,-(NEW.cents-OLD.cents)*10000,'Card refund / dispute',NEW.payment_intent FROM site_billing WHERE user_id=NEW.user_id;
END;
CREATE TABLE prepaid_debits(id TEXT PRIMARY KEY,account TEXT NOT NULL,micros INTEGER NOT NULL,at INTEGER NOT NULL,route TEXT NOT NULL);
CREATE TRIGGER prepaid_debit BEFORE INSERT ON prepaid_debits BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account AND active=1 AND balance_micros-reserved_micros>=NEW.micros) THEN RAISE(ABORT,'insufficient_balance') END;
 UPDATE accounts SET balance_micros=balance_micros-NEW.micros WHERE id=NEW.account;
 INSERT INTO transactions(account,at,micros,concept,route,reference) VALUES(NEW.account,NEW.at,-NEW.micros,'Prepaid tool',NEW.route,NEW.id);
END;
