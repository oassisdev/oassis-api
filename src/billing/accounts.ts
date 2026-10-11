/**
 * Accounts with a balance: the API-key gate.
 *
 * The balance is debited with a conditional UPDATE (`... WHERE balance >= ?`),
 * which is atomic in SQLite: two simultaneous calls on the same account cannot
 * push it negative, and the one that arrives late gets "insufficient balance"
 * instead of free work.
 */

export interface Account {
  id: string;
  balanceMicros: number;
  maxSessions: number;
}

/** Key prefix. It is what makes a key recognisable at a glance in a log. */
export const KEY_PREFIX = "oas_";

/** Only the hash is stored: a stolen table hands out no working keys. */
export async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const body = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${KEY_PREFIX}${body}`;
}

export async function accountForKey(db: D1Database, key: string): Promise<Account | null> {
  const hash = await hashKey(key);
  const row = await db
    .prepare(
      `SELECT a.id AS id, a.balance_micros AS balance, a.max_sessions AS sessions
         FROM api_keys k JOIN accounts a ON a.id = k.account
        WHERE k.hash = ? AND k.revoked_at IS NULL AND a.active = 1`,
    )
    .bind(hash)
    .first<{ id: string; balance: number; sessions: number }>();
  if (!row) return null;
  return { id: row.id, balanceMicros: row.balance, maxSessions: row.sessions };
}

export interface Charge {
  concept: string;
  micros: number;
  route?: string;
  reference?: string;
}

/**
 * Debits the balance. Returns what is left, or `null` when there was not enough:
 * the check and the charge are the same operation, so there is no window between
 * "see if it covers it" and "take it".
 */
export async function charge(db: D1Database, account: string, c: Charge): Promise<number | null> {
  if (c.micros <= 0) return null;
  const res = await db
    .prepare(
      `UPDATE accounts SET balance_micros = balance_micros - ?1
        WHERE id = ?2 AND active = 1 AND balance_micros - reserved_micros >= ?1`,
    )
    .bind(c.micros, account)
    .run();
  if (!res.meta.changes) return null;

  const row = await db
    .prepare(`SELECT balance_micros AS balance FROM accounts WHERE id = ?`)
    .bind(account)
    .first<{ balance: number }>();

  await addEntry(db, account, -c.micros, c.concept, c.route, c.reference);
  return row?.balance ?? 0;
}

/**
 * Top-up or refund. Used by the admin script and, one day, by card payments. The
 * `reference` is what lets a refund be traced back to the job or session it came
 * from, which is the difference between explaining a balance and guessing at it.
 */
export async function credit(
  db: D1Database,
  account: string,
  micros: number,
  concept: string,
  reference?: string,
): Promise<void> {
  await db
    .prepare(`UPDATE accounts SET balance_micros = balance_micros + ? WHERE id = ?`)
    .bind(micros, account)
    .run();
  await addEntry(db, account, micros, concept, undefined, reference);
}

async function addEntry(
  db: D1Database,
  account: string,
  micros: number,
  concept: string,
  route?: string,
  reference?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO transactions (account, at, micros, concept, route, reference)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(account, Date.now(), micros, concept, route ?? null, reference ?? null)
    .run();
}

/**
 * A wallet payment, recorded under the same account column as everything else. There is no
 * balance to move — the money arrived on-chain — so this is history, not accounting: it is
 * what lets a wallet caller read their own usage and what tells us which addresses pay.
 */
export async function recordWalletPayment(
  db: D1Database,
  identity: string,
  micros: number,
  route: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO transactions (account, at, micros, concept, route) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(identity, Date.now(), -micros, "x402", route)
    .run();
}

/** Sessions open right now: the limit that stops browsers being left running. */
export async function openSessions(db: D1Database, account: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE account = ? AND closed_at IS NULL`)
    .bind(account)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Free sessions open right now, across everybody: they hold the scarcest resource we have. */
export async function openFreeSessions(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE gate = 'free' AND closed_at IS NULL`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function registerSession(
  db: D1Database,
  id: string,
  account: string | null,
  gate: "key" | "x402" | "free",
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (id, account, gate, opened_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET opened_at = excluded.opened_at, closed_at = NULL`,
    )
    .bind(id, account, gate, Date.now())
    .run();
}

/**
 * Closes the session and bills the time it stayed open. If the account ran out
 * of balance the close goes ahead anyway: leaving the browser running to bill
 * better would mean billing for our own hole.
 */
export async function closeSession(
  db: D1Database,
  id: string,
  timeCost: (openedAt: number) => number,
): Promise<{ charged: number } | null> {
  const row = await db
    .prepare(`SELECT account, opened_at AS openedAt FROM sessions WHERE id = ? AND closed_at IS NULL`)
    .bind(id)
    .first<{ account: string | null; openedAt: number }>();
  if (!row) return null;

  const micros = timeCost(row.openedAt);
  let charged = 0;
  if (row.account && micros > 0) {
    const balance = await charge(db, row.account, {
      concept: "session time",
      micros,
      route: "/web/v1/session",
      reference: id,
    });
    charged = balance === null ? 0 : micros;
  }

  await db
    .prepare(`UPDATE sessions SET closed_at = ?, charged_micros = charged_micros + ? WHERE id = ?`)
    .bind(Date.now(), charged, id)
    .run();
  return { charged };
}

/**
 * Who a session belongs to. `account` is null for sessions opened through the
 * wallet gate, where there is no account to attribute them to.
 */
export async function sessionOwner(
  db: D1Database,
  id: string,
): Promise<{ account: string | null; gate: string } | null> {
  const row = await db
    .prepare(`SELECT account, gate FROM sessions WHERE id = ? AND closed_at IS NULL`)
    .bind(id)
    .first<{ account: string | null; gate: string }>();
  return row ?? null;
}

/** Who a batch job belongs to. Same rule as a session: null means the wallet gate. */
export async function jobOwner(
  db: D1Database,
  id: string,
): Promise<{ account: string | null; gate: string } | null> {
  const row = await db
    .prepare(`SELECT account, gate FROM jobs WHERE id = ?`)
    .bind(id)
    .first<{ account: string | null; gate: string }>();
  return row ?? null;
}

export async function registerJob(
  db: D1Database,
  id: string,
  account: string | null,
  gate: "key" | "x402" | "free",
  urls: number,
  chargedMicros: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO jobs (id, account, gate, created_at, urls, charged_micros)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, account, gate, Date.now(), urls, chargedMicros)
    .run();
}

export type SessionAccess = "ok" | "not_found" | "denied";

/**
 * Whether this caller may drive this session.
 *
 * A `sessionId` is the only handle on a live browser, and that browser may hold
 * someone else's cookies and signed-in state. So it is not enough to hold a valid
 * key: the session has to be yours. One comparison covers every case — a session
 * opened with a key demands that same account, and one opened with a wallet (no
 * account) demands a caller with no account either, so a key holder cannot walk
 * into a wallet session or the other way round.
 */
export function sessionAccess(
  row: { account: string | null } | null,
  caller: string | null,
): SessionAccess {
  if (!row) return "not_found";
  if ((row.account ?? null) !== (caller ?? null)) return "denied";
  return "ok";
}
