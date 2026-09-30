import { describe, expect, it } from "vitest";
import { cacheKey, cacheable, readCache, writeCache } from "../src/cache";
import { CachedRenderer, cachedFormats } from "../src/cached-renderer";
import { scrapeRequest } from "../src/schema";
import { scrapePrice, PRICES, priceOfRequest } from "../src/billing/prices";
import { renderPlan } from "../src/scrape";
import type { Env, Renderer } from "../src/types";

/** KV of convenience: a Map with the two methods the cache uses. */
function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      async get(key: string, type?: string) {
        const raw = store.get(key);
        if (!raw) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    } as unknown as KVNamespace,
  };
}

const envWith = (kv?: KVNamespace) => ({ CACHE: kv }) as unknown as Env;

describe("what may be cached", () => {
  const base = { url: "https://a.com", formats: ["markdown"] as const };

  it("nothing without maxAge: a page is fresh unless the caller says otherwise", () => {
    expect(cacheable(scrapeRequest.parse(base))).toBe(false);
    expect(cacheable(scrapeRequest.parse({ ...base, maxAge: 0 }))).toBe(false);
    expect(cacheable(scrapeRequest.parse({ ...base, maxAge: 60_000 }))).toBe(true);
  });

  it("never with credentials: the cache is shared by everyone", () => {
    const withAuth = { ...base, maxAge: 60_000, request: { auth: { username: "u", password: "p" } } };
    expect(cacheable(scrapeRequest.parse(withAuth))).toBe(false);

    const withCookies = { ...base, maxAge: 60_000, request: { cookies: [{ name: "s", value: "1" }] } };
    expect(cacheable(scrapeRequest.parse(withCookies))).toBe(false);

    const withHeaders = { ...base, maxAge: 60_000, request: { headers: { "x-token": "abc" } } };
    expect(cacheable(scrapeRequest.parse(withHeaders))).toBe(false);
  });

  it("not for raw html, which has no url to key on", () => {
    expect(cacheable(scrapeRequest.parse({ html: "<p>x</p>", maxAge: 60_000 }))).toBe(false);
  });
});

describe("the key is the render identity", () => {
  it("same action and options, same key — whatever the field order", async () => {
    const a = await cacheKey("markdown", { url: "https://a.com", viewport: { width: 800, height: 600 } });
    const b = await cacheKey("markdown", { viewport: { width: 800, height: 600 }, url: "https://a.com" });
    expect(a).toBe(b);
  });

  it("a different option or action is a different key", async () => {
    const base = await cacheKey("markdown", { url: "https://a.com" });
    expect(await cacheKey("markdown", { url: "https://b.com" })).not.toBe(base);
    expect(await cacheKey("content", { url: "https://a.com" })).not.toBe(base);
    expect(await cacheKey("markdown", { url: "https://a.com", gotoOptions: { waitUntil: "load" } })).not.toBe(base);
  });
});

describe("reading and writing", () => {
  it("what was stored comes back while it is young enough", async () => {
    const { kv } = fakeKV();
    const env = envWith(kv);
    await writeCache(env, "k", "content");
    expect(await readCache(env, "k", 60_000)).toEqual({ value: "content" });
  });

  it("an entry older than maxAge is not served", async () => {
    const { kv, store } = fakeKV();
    const env = envWith(kv);
    store.set("k", JSON.stringify({ value: "old", storedAt: Date.now() - 120_000 }));
    expect(await readCache(env, "k", 60_000)).toBeNull();
    expect(await readCache(env, "k", 600_000)).toEqual({ value: "old" });
  });

  it("with no cache bound, everything is a miss and nothing breaks", async () => {
    const env = envWith(undefined);
    await writeCache(env, "k", "x");
    expect(await readCache(env, "k", 60_000)).toBeNull();
  });
});

describe("CachedRenderer", () => {
  function counting(): Renderer & { calls: number } {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      async run() {
        calls += 1;
        return { value: `render ${calls}`, browserMs: 250 };
      },
    } as Renderer & { calls: number };
  }

  it("renders once and serves the rest from the cache", async () => {
    const { kv } = fakeKV();
    const inner = counting();
    const renderer = new CachedRenderer(envWith(kv), inner, 60_000);

    const first = await renderer.run("markdown", { url: "https://a.com" });
    const second = await renderer.run("markdown", { url: "https://a.com" });

    expect(inner.calls).toBe(1);
    expect(first).toEqual({ value: "render 1", browserMs: 250 });
    // A hit reports zero browser time, because nothing was rendered.
    expect(second).toEqual({ value: "render 1", browserMs: 0, cached: true });
  });

  it("different options are a different render", async () => {
    const { kv } = fakeKV();
    const inner = counting();
    const renderer = new CachedRenderer(envWith(kv), inner, 60_000);
    await renderer.run("markdown", { url: "https://a.com" });
    await renderer.run("markdown", { url: "https://b.com" });
    expect(inner.calls).toBe(2);
  });
});

describe("the price carries the discount", () => {
  it("a hit costs the cache price, not the format's", () => {
    expect(scrapePrice(["markdown"])).toBe(1_000);
    expect(scrapePrice(["markdown"], ["markdown"])).toBe(PRICES.cacheHit);
    expect(scrapePrice(["markdown", "pdf"], ["pdf"])).toBe(1_000 + PRICES.cacheHit);
    expect(priceOfRequest("scrape", { formats: ["json"] }, ["json"])).toBe(PRICES.cacheHit);
  });

  it("the hits are known before charging, from the same plan that does the work", async () => {
    const { kv } = fakeKV();
    const env = envWith(kv);
    const req = scrapeRequest.parse({
      url: "https://a.com",
      formats: ["markdown", "pdf"],
      maxAge: 60_000,
    });
    const plan = renderPlan(req);

    expect(await cachedFormats(env, plan, 60_000)).toEqual([]);

    // Render markdown only, and the price of the next call should reflect exactly that.
    const renderer = new CachedRenderer(env, { async run() { return { value: "md", browserMs: 10 }; } }, 60_000);
    await renderer.run(plan[0]!.action, plan[0]!.options);

    expect(await cachedFormats(env, plan, 60_000)).toEqual(["markdown"]);
    expect(priceOfRequest("scrape", req, ["markdown"])).toBe(PRICES.cacheHit + 2_000);
  });
});
