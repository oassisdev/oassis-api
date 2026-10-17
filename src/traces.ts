/**
 * The call log: what was asked, what came back, how long it took.
 *
 * Retained for 30 days, independent of traffic volume.
 *
 * - truncates both bodies, because the point is seeing what a caller asked for, not
 *   keeping a copy of the web;
 * - never reads a large response body at all — a base64 PDF is recorded as its size;
 * - is written after the answer has gone out, and a failure to write is swallowed. A
 *   log that can break the request it is logging is worse than no log.
 */

import type { Context, Hono, MiddlewareHandler } from "hono";
import type { Env } from "./types";

/** Complete rolling retention window; no row cap may discard younger calls. */
export const TRACE_DAYS = 30;

/** Characters of each body. Enough to see the url asked for and the shape of the answer. */
const BODY_CHARS = 400;

/** Responses larger than this are recorded as a size, not read. */
const MAX_BODY_BYTES = 8_192;

/** Pruning runs on this share of writes: often enough to hold the cap, rarely enough to be free. */
const PRUNE_CHANCE = 0.05;

/** Paths that are the back-office looking at itself, or a file. Logging them is noise. */
const SKIP = /^\/(health|console|playground|favicon|apple-touch-icon|icon-512|robots\.txt|sitemap\.xml)/;

const clip = (s: string | null | undefined, n = BODY_CHARS): string | null => {
  if (!s) return null;
  const redact=(v:unknown):unknown=>{
    if(Array.isArray(v))return v.map(redact);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='access_token'?'[redacted]':redact(x)]));
    if(typeof v==='string'&&(v.startsWith('{')||v.startsWith('['))){try{return JSON.stringify(redact(JSON.parse(v)));}catch{}}
    return v;
  };
  let text=s;try{text=JSON.stringify(redact(JSON.parse(s)));}catch{}
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};

export interface Trace {
  at: number;
  channel: "mcp" | "http";
  method: string;
  path: string;
  tool: string | null;
  status: number;
  durationMs: number;
  ip: string | null;
  country: string | null;
  client: string | null;
  wallet: string | null;
  account: string | null;
  reqBody: string | null;
  respBody: string | null;
}

/** Writes one row and, now and then, drops whatever is over the ceiling. */
export async function recordTrace(env: Env, t: Trace): Promise<void> {
  const db = env.BILLING;
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO traces
           (at, channel, method, path, tool, status, duration_ms, ip, country, client, wallet, account, req_body, resp_body)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        t.at, t.channel, t.method, t.path, t.tool, t.status, t.durationMs,
        t.ip, t.country, t.client, t.wallet, t.account, t.reqBody, t.respBody,
      )
      .run();
    if (Math.random() < PRUNE_CHANCE) await pruneTraces(env);
  } catch {
    /* a log that breaks the request it logs is worse than no log */
  }
}

/** Delete only calls older than the retention window. */
export async function pruneTraces(env: Env): Promise<void> {
  const db = env.BILLING;
  if (!db) return;
  try {
    await db
      .prepare(`DELETE FROM traces WHERE at < ?1`)
      .bind(Date.now() - TRACE_DAYS * 86_400_000)
      .run();
  } catch {
    /* pruning is maintenance: it can wait for the next write */
  }
}

/** The tool a call is about: the MCP tool name, or the last segment of the path. */
function toolOf(path: string, body: unknown): string | null {
  if (path === "/mcp") {
    const b = body as { method?: string; params?: { name?: string } } | null;
    return b?.params?.name ?? b?.method ?? null;
  }
  const parts = path.split("/").filter(Boolean);
  return parts.length ? (parts[parts.length - 1] ?? null) : null;
}

/**
 * Reads the answer without paying for it: a large body is recorded as its size rather
 * than pulled into memory to be thrown away.
 */
async function bodyOf(res: Response): Promise<string | null> {
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return `(${length} bytes, not stored)`;
  const type = res.headers.get("content-type") ?? "";
  if (!/json|text|event-stream/i.test(type)) return `(${type || "no content-type"}, not stored)`;
  try {
    const text = await res.clone().text();
    if (text.length > MAX_BODY_BYTES) return `(${text.length} chars, not stored)`;
    return clip(text);
  } catch {
    return null;
  }
}

/**
 * Logs every product call. Mounted first, so it sees the answer whatever produced it.
 */
export function traceLog(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // Never capture passwords, OAuth codes, session tokens or account responses.
    if (/^\/(?:api\/(?:auth|billing)(?:\/|$)|login(?:\/|$)|signup(?:\/|$)|dashboard(?:\/|$))/.test(path) || SKIP.test(path)) return next();

    // The console probes the product in process, through app.fetch, to know whether it is
    // alive. Those have no client address because there is no client: they are us. Logged,
    // they drowned the real traffic — 479 of 503 calls to scrape were the console looking
    // at itself. Cloudflare sets this header on every request that came from outside.
    if (!c.req.header("cf-connecting-ip")) return next();

    const started = Date.now();
    // Read the request body before the handler consumes it; Hono caches the parse.
    let reqBody: unknown = null;
    if (c.req.method === "POST") {
      try {
        reqBody = await c.req.raw.clone().json();
      } catch {
        reqBody = null;
      }
    }

    await next();

    const res = c.res;
    const payer = c.get("payer" as never) as { wallet?: string; identity?: string } | undefined;
    const trace: Trace = {
      at: started,
      channel: path === "/mcp" ? "mcp" : "http",
      method: c.req.method,
      path,
      tool: toolOf(path, reqBody),
      status: res.status,
      durationMs: Date.now() - started,
      ip: c.req.header("cf-connecting-ip") ?? null,
      country: (c.req.raw as { cf?: { country?: string } }).cf?.country ?? null,
      client: clip(c.req.header("user-agent"), 120),
      wallet: payer?.wallet ?? null,
      account: payer?.identity ?? null,
      reqBody: reqBody === null ? null : clip(JSON.stringify(reqBody)),
      respBody: await bodyOf(res),
    };

    // After the answer has gone out: the caller never waits for our bookkeeping.
    c.executionCtx.waitUntil(recordTrace(c.env, trace));
  };
}

/** Mounts the log. Called before any route, so nothing escapes it. */
export function mountTraceLog(app: Hono<{ Bindings: Env }>) {
  app.use("*", traceLog());
}

export type { Context };
