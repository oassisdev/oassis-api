import { describe, expect, it } from "vitest";
import { account } from "../src/account";

/**
 * Fake D1 that answers each query of the account router with canned rows, keyed by
 * a fragment of its SQL. Enough to pin the shape of the answers and, above all,
 * that none of these routes charges anything.
 */
function fakeEnv(opts: { known?: boolean } = {}) {
  const known = opts.known ?? true;
  const writes: string[] = [];
  const BILLING = {
    prepare(sql: string) {
      if (/UPDATE|INSERT/i.test(sql)) writes.push(sql);
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("FROM api_keys")) {
                return known ? { id: "acct-1", balance: 250_000, sessions: 3 } : null;
              }
              // One query now answers spend and open sessions together.
              if (sql.includes("COALESCE")) {
                return { day: 12_000, month: 40_000, total: 55_000, open: 1 };
              }
              return null;
            },
            async all() {
              if (sql.includes("strftime")) {
                return { results: [{ day: "2026-09-25", micros: 12_000, calls: 3 }] };
              }
              if (sql.includes("GROUP BY concept")) {
                return { results: [{ concept: "scrape", micros: 8_000, calls: 2 }] };
              }
              if (sql.includes("FROM transactions")) {
                return {
                  results: [
                    { at: 1_700_000_000_000, micros: -1_000, concept: "scrape", route: "/v1/scrape", reference: null },
                  ],
                };
              }
              if (sql.includes("closed_at IS NULL")) {
                return { results: [{ id: "sess-1", openedAt: Date.now() - 30_000, charged: 20_000 }] };
              }
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { env: { BILLING } as never, writes };
}

const get = (path: string, key: string | null, env: never) =>
  account.request(path, { headers: key ? { authorization: `Bearer ${key}` } : {} }, env);

describe("who is asking", () => {
  it("without a key it explains that a wallet has no account", async () => {
    const { env } = fakeEnv();
    const r = await get("/v1/account", null, env);
    expect(r.status).toBe(401);
    expect(((await r.json()) as any).message).toMatch(/x402/);
  });

  it("an unknown key is rejected", async () => {
    const { env } = fakeEnv({ known: false });
    expect((await get("/v1/account", "oas_nope", env)).status).toBe(401);
  });

  it("served under both prefixes", async () => {
    const { env } = fakeEnv();
    expect((await get("/v1/account", "oas_k", env)).status).toBe(200);
    expect((await get("/web/v1/account", "oas_k", env)).status).toBe(200);
  });
});

describe("what it answers", () => {
  it("/account: balance, spend and open sessions", async () => {
    const { env } = fakeEnv();
    const body = (await (await get("/v1/account", "oas_k", env)).json()) as any;
    expect(body.balance).toBe("$0.25");
    expect(body.spent).toEqual({ last24h: "$0.012", last30d: "$0.04", allTime: "$0.055" });
    expect(body.sessions).toEqual({ open: 1, max: 3 });
  });

  it("/account/usage: per day and per concept, with the window clamped", async () => {
    const { env } = fakeEnv();
    const body = (await (await get("/v1/account/usage?days=999", "oas_k", env)).json()) as any;
    expect(body.days).toBe(90);
    expect(body.byDay[0]).toEqual({ day: "2026-09-25", spent: "$0.012", calls: 3 });
    expect(body.byConcept[0]).toEqual({ concept: "scrape", spent: "$0.008", calls: 2 });
  });

  it("/account/transactions: a charge keeps its sign, so it cannot be read as a top-up", async () => {
    const { env } = fakeEnv();
    const body = (await (await get("/v1/account/transactions", "oas_k", env)).json()) as any;
    expect(body.transactions[0].amount).toBe("-$0.001");
    expect(body.transactions[0].micros).toBe(-1_000);
    expect(body.transactions[0].at).toBe("2023-11-14T22:13:20.000Z");
  });

  it("/account/sessions: what is still being billed by the minute", async () => {
    const { env } = fakeEnv();
    const body = (await (await get("/v1/account/sessions", "oas_k", env)).json()) as any;
    expect(body.open[0].sessionId).toBe("sess-1");
    expect(body.open[0].openForSeconds).toBeGreaterThanOrEqual(29);
    expect(body.open[0].chargedSoFar).toBe("$0.02");
  });
});

describe("asking is free", () => {
  it("no route writes a movement or touches the balance", async () => {
    const { env, writes } = fakeEnv();
    for (const path of ["/v1/account", "/v1/account/usage", "/v1/account/transactions", "/v1/account/sessions"]) {
      expect((await get(path, "oas_k", env)).status).toBe(200);
    }
    expect(writes).toEqual([]);
  });
});

describe("what asking costs the caller", () => {
  /**
   * These routes are free for the caller, so every query is ours to pay for. An agent that
   * checks its balance before each call should not cost three round trips to D1.
   */
  it("/account answers with a single query", async () => {
    let queries = 0;
    const BILLING = {
      prepare(sql: string) {
        if (!sql.includes("FROM api_keys")) queries += 1;
        return {
          bind() {
            return {
              async first() {
                if (sql.includes("FROM api_keys")) return { id: "a1", balance: 1_000, sessions: 3 };
                return { day: 0, month: 0, total: 0, open: 0 };
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    };
    const r = await account.request(
      "/v1/account",
      { headers: { authorization: "Bearer oas_k" } },
      { BILLING } as never,
    );
    expect(r.status).toBe(200);
    expect(queries).toBe(1);
  });
});
