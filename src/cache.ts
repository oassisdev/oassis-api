/**
 * Render cache.
 *
 * A page already rendered should not be paid for twice. The entry is keyed by the
 * exact render identity —the provider action plus every option that changes its
 * output— so a cached answer is the answer that same request would have produced.
 *
 * The saving is passed on: a cache hit is priced at `PRICES.cacheHit` instead of
 * the format's price, and the price is decided BEFORE the work, so the 402
 * challenge and the charge both already reflect it.
 *
 * `maxAge` is the client's call, not ours: it says how old an answer it is willing
 * to accept. Without it, nothing is read from the cache — an agent that asks for a
 * page expects today's page unless it says otherwise.
 */

import type { Action, Env } from "./types";
import type { ScrapeRequest } from "./schema";

/** How long an entry survives. Reading is limited by the caller's `maxAge`. */
const TTL_SECONDS = 7 * 24 * 60 * 60;

/** Entries above this are not stored: a huge PDF is not worth the write. */
const MAX_STORED_BYTES = 2_000_000;

interface Entry {
  value: unknown;
  storedAt: number;
}

/**
 * Whether this request may touch the cache at all.
 *
 * Credentials are the hard line: cookies, auth or custom headers mean the page was
 * rendered for one particular caller, and the cache is shared by everyone. Storing
 * that would hand someone else's signed-in page to the next caller.
 */
export function cacheable(req: ScrapeRequest): boolean {
  if (!req.maxAge || req.maxAge <= 0) return false;
  if (req.request?.auth || req.request?.cookies || req.request?.headers) return false;
  if (req.html) return false; // no url, no identity worth keying on
  return true;
}

/** The render identity: same action and same options mean the same answer. */
export async function cacheKey(action: Action, options: Record<string, unknown>): Promise<string> {
  const stable = JSON.stringify(options, Object.keys(options).sort());
  const data = new TextEncoder().encode(`${action}\n${stable}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A stored value, if there is one and it is young enough for this caller. */
export async function readCache(env: Env, key: string, maxAgeMs: number): Promise<{ value: unknown } | null> {
  if (!env.CACHE || maxAgeMs <= 0) return null;
  const raw = await env.CACHE.get(key, "json").catch(() => null);
  if (!raw) return null;
  const entry = raw as Entry;
  if (typeof entry?.storedAt !== "number") return null;
  if (Date.now() - entry.storedAt > maxAgeMs) return null;
  return { value: entry.value };
}

export async function writeCache(env: Env, key: string, value: unknown): Promise<void> {
  if (!env.CACHE) return;
  const body = JSON.stringify({ value, storedAt: Date.now() } satisfies Entry);
  if (body.length > MAX_STORED_BYTES) return;
  await env.CACHE.put(key, body, { expirationTtl: TTL_SECONDS }).catch(() => undefined);
}
