import { describe, expect, it } from "vitest";
import {
  claimFreeCall,
  gatewayOf,
  FREE_EVER,
  FREE_GATEWAY_DAY,
  FREE_PER_DAY,
  type FreeCall,
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

/** Smithery's own infrastructure, measured on 2026-09-30. */
const SMITHERY = "2a06:98c0:3600::103";
const search: FreeCall = { tool: "web_search_exa", micros: 7_000 };
const ua = "claude-mcp/1.0";

describe("callers who arrive through a gateway", () => {
  it("recognises a gateway, and only a gateway", () => {
    expect(gatewayOf(SMITHERY)).toBe("smithery");
    expect(gatewayOf("1.2.3.4")).toBeNull();
    expect(gatewayOf("2a06:98c0:3700::1")).toBeNull();
  });

  /**
   * Smithery does not forward the client's address, so all of its users are one caller to
   * us. With a once-ever counter, the first arrival spent it for everyone, for good.
   */
  it("spends the gateway's pool, not a single caller's allowance", async () => {
    const { env } = envWithCounter();
    let allowed = 0;
    for (let i = 0; i < FREE_GATEWAY_DAY.searches + 2; i += 1) {
      const v = await claimFreeCall(env, { ip: SMITHERY, userAgent: ua }, search);
      if (v.ok) allowed += 1;
    }
    expect(allowed).toBe(FREE_GATEWAY_DAY.searches);
  });

  it("gives a gateway more reads a day than one caller gets", async () => {
    expect(FREE_GATEWAY_DAY.scrape).toBeGreaterThan(FREE_PER_DAY.scrape);
    expect(FREE_GATEWAY_DAY.sessions).toBeGreaterThan(FREE_EVER.sessions);
  });

  /** The point of the pool: it refills. A shared counter that never resets is a closed door. */
  it("refills the next day, unlike the once-ever counter", async () => {
    const { env, store } = envWithCounter();
    for (let i = 0; i < FREE_GATEWAY_DAY.searches; i += 1) {
      await claimFreeCall(env, { ip: SMITHERY, userAgent: ua }, search);
    }
    expect((await claimFreeCall(env, { ip: SMITHERY, userAgent: ua }, search)).ok).toBe(false);

    // Tomorrow: the day rolls over and the gateway's own counters go with it.
    for (const key of [...store.keys()]) if (key.includes("free:")) store.delete(key);
    expect((await claimFreeCall(env, { ip: SMITHERY, userAgent: ua }, search)).ok).toBe(true);
  });

  it("keeps the gateway's pool separate from an ordinary caller's", async () => {
    const { env } = envWithCounter();
    for (let i = 0; i < FREE_GATEWAY_DAY.searches; i += 1) {
      await claimFreeCall(env, { ip: SMITHERY, userAgent: ua }, search);
    }
    // Someone arriving directly still has their own, untouched.
    const direct = await claimFreeCall(env, { ip: "9.9.9.9", userAgent: ua }, search);
    expect(direct.ok, "a gateway's traffic spent a direct caller's allowance").toBe(true);
  });

  it("still gives an ordinary caller exactly the once-ever allowance", async () => {
    const { env } = envWithCounter();
    let allowed = 0;
    for (let i = 0; i < FREE_EVER.searches + 2; i += 1) {
      const v = await claimFreeCall(env, { ip: "5.6.7.8", userAgent: ua }, search);
      if (v.ok) allowed += 1;
    }
    expect(allowed).toBe(FREE_EVER.searches);
  });
});
