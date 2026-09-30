/**
 * A renderer that answers from the cache when it can, and stores what it renders.
 *
 * It wraps any `Renderer`, so neither the orchestrator nor the provider know the
 * cache exists: they keep seeing one interface. A cached answer reports
 * `browserMs: 0`, which is the truth — nothing was rendered — and that is what
 * makes `metadata.browserMsUsed` still mean what it says.
 */

import { cacheKey, readCache, writeCache } from "./cache";
import type { Action, Env, RenderResult, Renderer } from "./types";

export class CachedRenderer implements Renderer {
  constructor(
    private readonly env: Env,
    private readonly inner: Renderer,
    /** How old an answer the caller accepts. 0 disables reading. */
    private readonly maxAgeMs: number,
  ) {}

  async run(action: Action, options: Record<string, unknown>): Promise<RenderResult> {
    const key = await cacheKey(action, options);

    const hit = await readCache(this.env, key, this.maxAgeMs);
    if (hit) return { value: hit.value, browserMs: 0, cached: true };

    const fresh = await this.inner.run(action, options);
    // Stored without blocking the answer: the client should not wait on our cache.
    await writeCache(this.env, key, fresh.value);
    return fresh;
  }
}

/**
 * Which formats this request would get from the cache. Used to price the call
 * BEFORE doing the work, so the 402 challenge and the charge already carry the
 * discount instead of a refund afterwards.
 */
export async function cachedFormats(
  env: Env,
  plan: { format: string; action: Action; options: Record<string, unknown> }[],
  maxAgeMs: number,
): Promise<string[]> {
  const hits = await Promise.all(
    plan.map(async (p) =>
      (await readCache(env, await cacheKey(p.action, p.options), maxAgeMs)) ? p.format : null,
    ),
  );
  return hits.filter((f): f is string => f !== null);
}
