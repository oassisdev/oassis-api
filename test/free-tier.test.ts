import { describe, expect, it, vi } from "vitest";
import {
  PAID_OVER_MCP,
  FREE_SESSION_SLOTS,
  checkFreeCall,
  explainRefusal,
  looksLikeClient,
} from "../src/free-tier";

const client = { userAgent: "MiAgente/1.0" };

describe("the keyless MCP tier", () => {
  it("has no daily or lifetime allowance: the same caller can repeat any free tool", async () => {
    for (let i = 0; i < 50; i++) {
      expect(await checkFreeCall(client, { tool: "web_map", url: "https://example.org/" })).toBeNull();
    }
  });

  it("refuses search, which is paid, and says the price and how to pay", async () => {
    expect(await checkFreeCall(client, { tool: "web_search_exa" })).toBe("paid_search");
    expect(PAID_OVER_MCP.has("web_search_exa")).toBe(true);
    const text = explainRefusal("paid_search", "$0.007");
    expect(text).toContain("$0.007");
    expect(text).toContain("/web/v1/search");
    expect(text).toContain("Authorization: Bearer oas_");
  });

  it("lets every other tool through, including crawls and batches", async () => {
    for (const tool of ["web_scrape", "web_session_open", "web_act", "web_crawl", "web_scrape_batch"]) {
      expect(await checkFreeCall(client, { tool })).toBeNull();
    }
  });

  it("refuses a client that identifies as an HTTP library", async () => {
    expect(looksLikeClient("curl/8.4.0")).toBe(false);
    expect(looksLikeClient(undefined)).toBe(false);
    expect(looksLikeClient("MiAgente/1.0")).toBe(true);
    expect(await checkFreeCall({ userAgent: "curl/8.4.0" }, { tool: "web_scrape" })).toBe("not_a_client");
    expect(explainRefusal("not_a_client", "$0.001")).toContain("User-Agent");
  });

  it("caps browser sessions open at once, as capacity", async () => {
    expect(await checkFreeCall(client, { tool: "web_session_open", sessionsOpen: FREE_SESSION_SLOTS - 1 })).toBeNull();
    expect(await checkFreeCall(client, { tool: "web_session_open", sessionsOpen: FREE_SESSION_SLOTS })).toBe("sessions_busy");
  });

  it("honours robots.txt for every url of a free batch, not only the first", async () => {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL) => {
        const href = String(input);
        if (href.endsWith("/robots.txt") && href.includes("blocked.example")) {
          return new Response("User-agent: *\nDisallow: /private", { status: 200 });
        }
        return new Response("", { status: 404 });
      },
    );
    try {
      expect(
        await checkFreeCall(client, {
          tool: "web_scrape_batch",
          urls: ["https://open.example/a", "https://blocked.example/private/x"],
        }),
      ).toBe("robots");
      expect(
        await checkFreeCall(client, {
          tool: "web_scrape_batch",
          urls: ["https://open.example/a", "https://open.example/b"],
        }),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
