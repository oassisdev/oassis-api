import { describe, expect, it } from "vitest";
import {
  claimFreeCall,
  releaseFreeCall,
  explainRefusal,
  formatsNotFree,
  freeTable,
  FREE_CASH_DAY,
  FREE_EVER,
  FREE_PER_DAY,
  FREE_PER_HOST,
  looksLikeClient,
  robotsAllow,
  type FreeCall,
  type FreeRefusal,
} from "../src/free-tier";
import type { Env } from "../src/types";

function envWithCounter() {
  const store = new Map<string, string>();
  const CACHE = {
    async get(key: string, type?: string) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
  return { env: { CACHE } as unknown as Env, store };
}

const client = { ip: "1.2.3.4", userAgent: "claude-mcp/1.0" };

function withoutRobots<T>(run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const read = (n = 1): FreeCall => ({
  tool: "web_scrape",
  micros: 1_000,
  url: `https://site${n}.example/page`,
  formats: ["markdown"],
});

describe("what a stranger can do", () => {
  it("ten reads and ten site listings a day", async () => {
    const { env } = envWithCounter();
    await withoutRobots(async () => {
      for (let i = 0; i < FREE_PER_DAY.scrape; i += 1) {
        expect((await claimFreeCall(env, client, read(i))).ok).toBe(true);
      }
      expect(await claimFreeCall(env, client, read(99))).toEqual({ ok: false, reason: "scrape_today" });

      // Maps are counted separately: running out of reads does not spend them.
      const map: FreeCall = { tool: "web_map", micros: 300, url: "https://a.com" };
      expect((await claimFreeCall(env, client, map)).ok).toBe(true);
    });
  });

  it("one browser session, ever — not a day", async () => {
    const { env } = envWithCounter();
    const open: FreeCall = { tool: "web_session_open", micros: 5_000, sessionsOpen: 0 };
    await withoutRobots(async () => {
      expect((await claimFreeCall(env, client, open)).ok).toBe(true);
      expect(await claimFreeCall(env, client, open)).toEqual({ ok: false, reason: "session_ever" });
    });
  });

  it("ten actions and five searches, also ever", async () => {
    const { env } = envWithCounter();
    await withoutRobots(async () => {
      for (let i = 0; i < FREE_EVER.actions; i += 1) {
        expect((await claimFreeCall(env, client, { tool: "web_act", micros: 500 })).ok).toBe(true);
      }
      expect(await claimFreeCall(env, client, { tool: "web_act", micros: 500 })).toEqual({
        ok: false,
        reason: "actions_ever",
      });

      for (let i = 0; i < FREE_EVER.searches; i += 1) {
        await claimFreeCall(env, client, { tool: "web_search_exa", micros: 7_000 });
      }
      expect(await claimFreeCall(env, client, { tool: "web_search_exa", micros: 7_000 })).toEqual({
        ok: false,
        reason: "searches_ever",
      });
    });
  });

  it("a crawl, a batch or an AI extraction needs a key", async () => {
    const { env } = envWithCounter();
    await withoutRobots(async () => {
      expect(await claimFreeCall(env, client, { tool: "web_crawl", micros: 20_000 })).toEqual({
        ok: false,
        reason: "needs_key",
      });
      expect(await claimFreeCall(env, client, { tool: "web_scrape_batch", micros: 20_000 })).toEqual({
        ok: false,
        reason: "needs_key",
      });
      expect(
        await claimFreeCall(env, client, { tool: "web_scrape", micros: 5_000, formats: ["json"] }),
      ).toEqual({ ok: false, reason: "format" });
    });
  });

  it("the reason for refusing a crawl is the first impression, and says so", () => {
    expect(explainRefusal("needs_key", "$0.02")).toMatch(/job to poll/);
  });
});

describe("the limits are separate, not a shared pool", () => {
  it("spending all the reads leaves the session and the searches intact", async () => {
    const { env } = envWithCounter();
    await withoutRobots(async () => {
      for (let i = 0; i < FREE_PER_DAY.scrape; i += 1) await claimFreeCall(env, client, read(i));
      const session = await claimFreeCall(env, client, {
        tool: "web_session_open",
        micros: 5_000,
        sessionsOpen: 0,
      });
      expect(session.ok).toBe(true);
      if (session.ok) expect(session.left.scrape).toBe(0);
    });
  });
});

describe("not a free crawler", () => {
  it("three pages of the same site a day", async () => {
    const { env } = envWithCounter();
    await withoutRobots(async () => {
      for (let i = 1; i <= FREE_PER_HOST; i += 1) {
        expect(
          (await claimFreeCall(env, client, { ...read(), url: `https://shop.com/p/${i}` })).ok,
        ).toBe(true);
      }
      expect(await claimFreeCall(env, client, { ...read(), url: "https://shop.com/p/9" })).toEqual({
        ok: false,
        reason: "host",
      });
    });
  });

  it("robots.txt is honoured, and an HTTP library spends nothing", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("User-agent: *\nDisallow: /private/", { status: 200 })) as typeof fetch;
    try {
      const { env, store } = envWithCounter();
      expect(await claimFreeCall(env, client, { ...read(), url: "https://a.com/private/x" })).toEqual({
        ok: false,
        reason: "robots",
      });
      expect(
        await claimFreeCall(env, { ip: "1.2.3.4", userAgent: "curl/8" }, read()),
      ).toEqual({ ok: false, reason: "not_a_client" });
      expect(store.size).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("a global ceiling bounds everybody, and no counter means no free tier", async () => {
    const { env, store } = envWithCounter();
    store.set(`free:spend:${new Date().toISOString().slice(0, 10)}`, String(5_000_000));
    await withoutRobots(async () => {
      expect(await claimFreeCall(env, client, read())).toEqual({ ok: false, reason: "global" });
    });
    expect(await claimFreeCall({} as Env, client, read())).toEqual({ ok: false, reason: "no_counter" });
  });

  it("the address is hashed, never stored", async () => {
    const { env, store } = envWithCounter();
    await withoutRobots(() =>
      claimFreeCall(env, { ip: "203.0.113.7", userAgent: "claude-mcp/1.0" }, read()),
    );
    for (const key of store.keys()) expect(key).not.toContain("203.0.113.7");
  });
});

describe("reading robots.txt", () => {
  const serve = async (body: string, status = 200) => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(body, { status })) as typeof fetch;
    try {
      return {
        private: await robotsAllow("https://a.com/private/page"),
        open: await robotsAllow("https://a.com/open/page"),
      };
    } finally {
      globalThis.fetch = original;
    }
  };

  it("honours a wildcard group and ignores one aimed elsewhere", async () => {
    expect(await serve("User-agent: *\nDisallow: /private/")).toEqual({ private: false, open: true });
    expect(await serve("User-agent: GPTBot\nDisallow: /")).toEqual({ private: true, open: true });
  });

  it("an empty Disallow and a missing file allow everything", async () => {
    expect(await serve("User-agent: *\nDisallow:")).toEqual({ private: true, open: true });
    expect(await serve("", 404)).toEqual({ private: true, open: true });
  });
});

describe("what the caller is shown", () => {
  it("every row names its endpoint and its tool", () => {
    for (const row of freeTable()) {
      expect(row.api).toMatch(/^(POST|GET|DELETE)/);
      expect(row.free.length).toBeGreaterThan(0);
      expect(row.what.length).toBeGreaterThan(10);
    }
  });

  it("everything a caller reads is in English", () => {
    const spanish = /[áéíóúñ¿¡]|\b(página|llamada|cuenta|saldo|clave|gratis|día|sesión)\b/i;
    for (const row of freeTable()) {
      expect(row.api + row.tool + row.what + row.free + (row.note ?? "")).not.toMatch(spanish);
    }
    const reasons: FreeRefusal[] = [
      "needs_key",
      "format",
      "scrape_today",
      "map_today",
      "host",
      "robots",
      "session_ever",
      "actions_ever",
      "searches_ever",
      "sessions_busy",
      "global",
      "not_a_client",
    ];
    for (const reason of reasons) {
      const message = explainRefusal(reason, "$0.001");
      expect(message).not.toMatch(spanish);
      expect(message).toContain("x402");
    }
  });

  it("json and heavy renders are not free", () => {
    expect(formatsNotFree(["markdown", "controls"])).toEqual([]);
    expect(formatsNotFree(["json", "pdf", "screenshot"])).toEqual(["json", "pdf", "screenshot"]);
  });

  it("a named client yes, a library default no", () => {
    expect(looksLikeClient("claude-mcp/1.0")).toBe(true);
    expect(looksLikeClient("python-requests/2.31")).toBe(false);
  });
});

describe("giving a free call back", () => {
  const searchCall: FreeCall = { tool: "web_search_exa", micros: 7000 };

  it("lets the caller use it again when the work did not happen", async () => {
    const { env } = envWithCounter();
    for (let i = 0; i < FREE_EVER.searches; i++) {
      expect((await claimFreeCall(env, client, searchCall)).ok).toBe(true);
    }
    // Spent to the last one.
    expect(await claimFreeCall(env, client, searchCall)).toEqual({ ok: false, reason: "searches_ever" });

    await releaseFreeCall(env, client, searchCall);

    const again = await claimFreeCall(env, client, searchCall);
    expect(again.ok).toBe(true);
  });

  it("gives back the day's budget too, so a failure does not eat it", async () => {
    const { env, store } = envWithCounter();
    const big: FreeCall = { tool: "web_map", micros: 500_000 };
    await claimFreeCall(env, client, big);
    const spent = () => Number([...store.entries()].find(([k]) => k.startsWith("free:spend:"))?.[1] ?? -1);
    expect(spent()).toBe(500_000);

    await releaseFreeCall(env, client, big);
    expect(spent()).toBe(0);
  });

  it("does not hand back more than was taken", async () => {
    const { env } = envWithCounter();
    await releaseFreeCall(env, client, searchCall);
    await releaseFreeCall(env, client, searchCall);
    // The allowance is what it always was, not more.
    for (let i = 0; i < FREE_EVER.searches; i++) {
      expect((await claimFreeCall(env, client, searchCall)).ok).toBe(true);
    }
    expect((await claimFreeCall(env, client, searchCall)).ok).toBe(false);
  });

  it("frees the host slot a failed read had taken", async () => {
    const { env } = envWithCounter();
    const page: FreeCall = { tool: "web_scrape", micros: 1000, url: "https://example.com/a" };
    await withoutRobots(async () => {
      for (let i = 0; i < FREE_PER_HOST; i++) expect((await claimFreeCall(env, client, page)).ok).toBe(true);
      expect(await claimFreeCall(env, client, page)).toEqual({ ok: false, reason: "host" });
      await releaseFreeCall(env, client, page);
      expect((await claimFreeCall(env, client, page)).ok).toBe(true);
    });
  });

  it("does nothing at all where there is no counter", async () => {
    await expect(releaseFreeCall({} as Env, client, searchCall)).resolves.toBeNull();
  });

  it("reports what the caller has again, for the answer to say so", async () => {
    const { env } = envWithCounter();
    await claimFreeCall(env, client, searchCall);
    const left = await releaseFreeCall(env, client, searchCall);
    // Not FREE_EVER.searches - 1: the call was given back, so nothing was spent.
    expect(left?.searches).toBe(FREE_EVER.searches);
  });
});

describe("the free searches have a budget of their own", () => {
  const search: FreeCall = { tool: "web_search_exa", micros: 7000 };
  const fits = Math.floor(FREE_CASH_DAY / 7000);

  /** A caller only gets five ever, so spending the day's budget takes several of them. */
  const callers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ip: `10.0.0.${i + 1}`, userAgent: "claude-mcp/1.0" }));

  it("spends the day on whoever comes, and then says so", async () => {
    const { env } = envWithCounter();
    let served = 0;
    for (const who of callers(20)) {
      for (let i = 0; i < FREE_EVER.searches; i++) {
        const claim = await claimFreeCall(env, who, search);
        if (!claim.ok) {
          expect(claim.reason).toBe("searches_today");
          expect(served).toBe(fits);
          return;
        }
        served++;
      }
    }
    throw new Error(`the budget never ran out: ${served} free searches served`);
  });

  it("is what stops a swarm, not the per-caller allowance", async () => {
    const { env } = envWithCounter();
    // Every one of these is a first-time caller with a full allowance of five.
    const refusals = new Set<string>();
    for (const who of callers(30)) {
      const claim = await claimFreeCall(env, who, search);
      if (!claim.ok) refusals.add(claim.reason);
    }
    expect([...refusals]).toEqual(["searches_today"]);
  });

  it("leaves the rest of the free tier alone", async () => {
    const { env } = envWithCounter();
    for (const who of callers(20)) {
      for (let i = 0; i < FREE_EVER.searches; i++) await claimFreeCall(env, who, search);
    }
    // Searches are spent for the day; reading a page is not paid in cash and still works.
    await withoutRobots(async () => {
      const page = await claimFreeCall(env, client, { tool: "web_scrape", micros: 1000, url: "https://example.com" });
      expect(page.ok).toBe(true);
    });
  });

  it("gives the budget back when the search did not happen", async () => {
    const { env } = envWithCounter();
    const spent = new Set(callers(fits + 2));
    let refused = 0;
    for (const who of spent) {
      for (let i = 0; i < FREE_EVER.searches; i++) {
        if (!(await claimFreeCall(env, who, search)).ok) refused++;
      }
    }
    expect(refused).toBeGreaterThan(0);

    // One of those searches failed on us: its money goes back, and one more fits.
    await releaseFreeCall(env, { ip: "10.0.0.1" }, search);
    const after = await claimFreeCall(env, { ip: "10.0.0.1", userAgent: "claude-mcp/1.0" }, search);
    expect(after.ok).toBe(true);
  });
});
