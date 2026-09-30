/**
 * Account introspection: balance, spend and what is open right now.
 *
 * An account is not part of the web family: the same key works for every family and
 * reads the same balance. It is served under both path shapes like everything else.
 *
 * All of it is **free**. Asking how much money you have left cannot cost money, and
 * an agent that has to spend to find out it is broke has no way to behave well.
 *
 * It needs a key: an x402 caller has no account to report on, and gets told so
 * instead of an empty answer that looks like an account with nothing in it.
 */

import { Hono, type Context } from "hono";
import { accountForKey } from "./billing/accounts";
import { inDollars } from "./billing/prices";
import type { Env } from "./types";

export const account = new Hono<{ Bindings: Env }>();

/** Routes are served under both prefixes, like the rest of the API. */
const bothPaths = (suffix: string) => [`/web/v1/${suffix}`, `/v1/${suffix}`];

interface Caller {
  id: string;
  balanceMicros: number;
  maxSessions: number;
}

/** Resolves the key without charging. Returns the response to send when it fails. */
async function caller(c: Context<{ Bindings: Env }>): Promise<Caller | Response> {
  const key = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!key) {
    return c.json(
      {
        success: false,
        error: "unauthorized",
        message:
          "Send your API key in `Authorization: Bearer oas_…`. Wallet callers have no account: with x402 you pay per call and there is no balance to report.",
      },
      401,
    );
  }
  const found = await accountForKey(c.env.BILLING, key);
  if (!found) {
    return c.json({ success: false, error: "unauthorized", message: "Invalid or revoked key." }, 401);
  }
  return found;
}

for (const route of bothPaths("account")) {
  /**
   * The one call an agent should make before planning work: what is left, what it
   * is allowed to hold open, and what it has spent lately.
   */
  account.get(route, async (c) => {
    const who = await caller(c);
    if (who instanceof Response) return who;

    /**
     * One query, not three. This route is free for the caller and billed to us by rows
     * read, and an agent that checks its balance before every call would have paid for
     * three round trips to answer one question.
     */
    const summary = await c.env.BILLING.prepare(
      `SELECT
         COALESCE((SELECT SUM(-micros) FROM transactions
                    WHERE account = ?1 AND micros < 0 AND at >= ?2), 0) AS day,
         COALESCE((SELECT SUM(-micros) FROM transactions
                    WHERE account = ?1 AND micros < 0 AND at >= ?3), 0) AS month,
         COALESCE((SELECT SUM(-micros) FROM transactions
                    WHERE account = ?1 AND micros < 0), 0) AS total,
         (SELECT COUNT(*) FROM sessions WHERE account = ?1 AND closed_at IS NULL) AS open`,
    )
      .bind(who.id, Date.now() - 86_400_000, Date.now() - 30 * 86_400_000)
      .first<{ day: number; month: number; total: number; open: number }>();

    return c.json({
      account: who.id,
      balance: inDollars(who.balanceMicros),
      balanceMicros: who.balanceMicros,
      spent: {
        last24h: inDollars(summary?.day ?? 0),
        last30d: inDollars(summary?.month ?? 0),
        allTime: inDollars(summary?.total ?? 0),
      },
      sessions: { open: summary?.open ?? 0, max: who.maxSessions },
    });
  });
}

for (const route of bothPaths("account/usage")) {
  /** Spend per day and per route, to see where the money goes without reading every entry. */
  account.get(route, async (c) => {
    const who = await caller(c);
    if (who instanceof Response) return who;

    const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? 7) || 7));
    const since = Date.now() - days * 86_400_000;

    const byDay = await c.env.BILLING.prepare(
      `SELECT strftime('%Y-%m-%d', at / 1000, 'unixepoch') AS day,
              SUM(-micros) AS micros, COUNT(*) AS calls
         FROM transactions WHERE account = ? AND micros < 0 AND at >= ?
        GROUP BY day ORDER BY day DESC`,
    )
      .bind(who.id, since)
      .all<{ day: string; micros: number; calls: number }>();

    const byConcept = await c.env.BILLING.prepare(
      `SELECT concept, SUM(-micros) AS micros, COUNT(*) AS calls
         FROM transactions WHERE account = ? AND micros < 0 AND at >= ?
        GROUP BY concept ORDER BY micros DESC`,
    )
      .bind(who.id, since)
      .all<{ concept: string; micros: number; calls: number }>();

    return c.json({
      days,
      byDay: (byDay.results ?? []).map((r) => ({
        day: r.day,
        spent: inDollars(r.micros),
        calls: r.calls,
      })),
      byConcept: (byConcept.results ?? []).map((r) => ({
        concept: r.concept,
        spent: inDollars(r.micros),
        calls: r.calls,
      })),
    });
  });
}

for (const route of bothPaths("account/transactions")) {
  /** The movements themselves, newest first: this is what explains a balance. */
  account.get(route, async (c) => {
    const who = await caller(c);
    if (who instanceof Response) return who;

    const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
    const rows = await c.env.BILLING.prepare(
      `SELECT at, micros, concept, route, reference FROM transactions
        WHERE account = ? ORDER BY id DESC LIMIT ?`,
    )
      .bind(who.id, limit)
      .all<{ at: number; micros: number; concept: string; route: string | null; reference: string | null }>();

    return c.json({
      transactions: (rows.results ?? []).map((r) => ({
        at: new Date(r.at).toISOString(),
        // Signed on purpose: a charge and a top-up have to be told apart.
        amount: inDollars(r.micros),
        micros: r.micros,
        concept: r.concept,
        ...(r.route ? { route: r.route } : {}),
        ...(r.reference ? { reference: r.reference } : {}),
      })),
    });
  });
}

for (const route of bothPaths("account/sessions")) {
  /** What is open right now, which is what is still being billed by the minute. */
  account.get(route, async (c) => {
    const who = await caller(c);
    if (who instanceof Response) return who;

    const rows = await c.env.BILLING.prepare(
      `SELECT id, opened_at AS openedAt, charged_micros AS charged FROM sessions
        WHERE account = ? AND closed_at IS NULL ORDER BY opened_at DESC`,
    )
      .bind(who.id)
      .all<{ id: string; openedAt: number; charged: number }>();

    return c.json({
      open: (rows.results ?? []).map((r) => ({
        sessionId: r.id,
        openedAt: new Date(r.openedAt).toISOString(),
        openForSeconds: Math.round((Date.now() - r.openedAt) / 1000),
        chargedSoFar: inDollars(r.charged),
      })),
      max: who.maxSessions,
    });
  });
}
