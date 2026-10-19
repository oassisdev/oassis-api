import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { TRACE_DAYS, mountTraceLog, pruneTraces, recordTrace, type Trace } from "../src/traces";
import { privacyPage } from "../src/legal";
import type { Context } from "hono";
import type { Env } from "../src/types";

/** A D1 stand-in that remembers the statements it was given. */
function db() {
  const sql: string[] = [];
  const binds: unknown[][] = [];
  const BILLING = {
    prepare(s: string) {
      sql.push(s);
      return {
        bind(...b: unknown[]) {
          binds.push(b);
          return { async run() { return { meta: { changes: 1 } }; } };
        },
        async run() { return { meta: { changes: 0 } }; },
      };
    },
  };
  return { env: { BILLING } as unknown as Env, sql, binds };
}

const trace = (over: Partial<Trace> = {}): Trace => ({
  at: Date.now(), channel: "http", method: "POST", path: "/web/v1/scrape", tool: "scrape",
  status: 200, durationMs: 12, ip: "1.2.3.4", country: "ES", client: "claude-mcp/1.0",
  wallet: null, account: null, reqBody: '{"url":"https://oassis.dev"}', respBody: "{}", ...over,
});

describe("the call log", () => {
  it("writes one row per call", async () => {
    const { env, sql } = db();
    await recordTrace(env, trace());
    expect(sql.join(" ")).toContain("INSERT INTO traces");
  });

  it("retains 30 days without deleting younger calls by row count", async () => {
    const { env, sql, binds } = db();
    await pruneTraces(env);
    expect(TRACE_DAYS).toBe(30);
    expect(sql).toEqual(["DELETE FROM traces WHERE at < ?1"]);
    const cutoff = binds[0]?.[0] as number;
    expect(Math.abs(Date.now() - cutoff - 30 * 86_400_000)).toBeLessThan(1000);
  });

  it("never lets a broken log break the call it is logging", async () => {
    const env = { BILLING: { prepare() { throw new Error("D1 is down"); } } } as unknown as Env;
    await expect(recordTrace(env, trace())).resolves.toBeUndefined();
  });

  it("does not log the back-office looking at itself", async () => {
    const { env, sql } = db();
    const app = new Hono<{ Bindings: Env }>();
    mountTraceLog(app);
    app.get("/health/dashboard", (c) => c.text("ok"));
    app.get("/web/v1/scrape", (c) => c.text("ok"));
    const ctx = { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext;

    const fuera = { "cf-connecting-ip": "1.2.3.4" };
    await app.fetch(new Request("https://api.oassis.dev/health/dashboard", { headers: fuera }), env, ctx);
    expect(sql.join(" "), "the console logged itself").not.toContain("INSERT INTO traces");

    await app.fetch(new Request("https://api.oassis.dev/web/v1/scrape", { headers: fuera }), env, ctx);
    expect(sql.join(" ")).toContain("INSERT INTO traces");
  });

  /**
   * The privacy policy is a promise in writing. A log it does not mention is a promise
   * broken by the commit that added the log.
   */
  it("is disclosed in the privacy policy, with its real limits", () => {
    const html = privacyPage({
      req: { url: "https://oassis.dev/privacy", path: "/privacy" },
      env: { BASE_URL: "https://api.oassis.dev" },
    } as unknown as Context<{ Bindings: Env }>);
    expect(html).toContain("request log");
    expect(html).toContain("without a row-count limit");
    expect(html).toContain(String(TRACE_DAYS));
  });
});

describe("what the log has to catch", () => {
  /**
   * The log was mounted after the billing guard and the MCP route, so it saw neither: a
   * 402 is answered by the guard without ever calling the next handler. It recorded free
   * GETs and nothing else, which is the opposite of what it is for.
   */
  it("records a call that a middleware answers without reaching a route", async () => {
    const { env, sql } = db();
    const app = new Hono<{ Bindings: Env }>();
    mountTraceLog(app);
    app.use("*", async (c) => c.json({ error: "payment required" }, 402));
    app.post("/web/v1/map", (c) => c.text("never reached"));

    const res = await app.fetch(
      new Request("https://api.oassis.dev/web/v1/map", {
        method: "POST",
        body: "{}",
        headers: { "cf-connecting-ip": "1.2.3.4" },
      }),
      env,
      { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(402);
    expect(sql.join(" "), "a 402 went unlogged").toContain("INSERT INTO traces");
  });
});

describe("our own probes", () => {
  /**
   * The console checks the product in process through app.fetch. Those requests have no
   * client address, because there is no client. Logged, they buried the real traffic.
   */
  it("does not log a request that came from inside", async () => {
    const { env, sql } = db();
    const app = new Hono<{ Bindings: Env }>();
    mountTraceLog(app);
    app.get("/web/v1/scrape", (c) => c.text("ok"));
    const ctx = { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext;

    await app.fetch(new Request("https://api.oassis.dev/web/v1/scrape"), env, ctx);
    expect(sql.join(" "), "an in-process probe was logged as traffic").not.toContain("INSERT INTO traces");

    await app.fetch(
      new Request("https://api.oassis.dev/web/v1/scrape", { headers: { "cf-connecting-ip": "1.2.3.4" } }),
      env,
      ctx,
    );
    expect(sql.join(" ")).toContain("INSERT INTO traces");
  });
});

it("attributes a free authenticated status read without storing the key", async () => {
  const captured: unknown[][] = [], pending: Promise<unknown>[] = [];
  const env = { BILLING: { prepare(sql: string) { return { bind(...args: unknown[]) { return {
    async first() { return { id: "site:owner", balance: 1000, sessions: 3 }; },
    async run() { if (sql.includes("INSERT INTO traces")) captured.push(args); return {}; },
  }; } }; } } } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();mountTraceLog(app);
  app.get("/tasks/v1/crawl/job", c => c.json({ status: "done" }));
  const res = await app.fetch(new Request("https://api.oassis.dev/tasks/v1/crawl/job", { headers: { authorization: "Bearer oas_fixtureprivate", "cf-connecting-ip": "192.0.2.1" } }), env, { waitUntil(p: Promise<unknown>) { pending.push(p); } } as unknown as ExecutionContext);
  expect(res.status).toBe(200);await Promise.all(pending);expect(captured).toHaveLength(1);expect(captured[0]?.[11]).toBe("site:owner");expect(JSON.stringify(captured)).not.toContain("oas_fixtureprivate");
});

it("preserves day one for the current UTC month when 30 rolling days would cut it off", async () => {
 const clock=vi.spyOn(Date,"now").mockReturnValue(Date.UTC(2026,9,31,20));
 try { const {env,binds}=db();await pruneTraces(env);expect(binds[0]?.[0]).toBe(Date.UTC(2026,9,1)); }
 finally { clock.mockRestore(); }
});
