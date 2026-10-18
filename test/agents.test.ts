import { describe, expect, it } from "vitest";
import { agentSchemas, AGENT_NAMES } from "../src/agents/catalog";
import { changedLines, extractPrice, matchesKeywords, parseAmount } from "../src/agents/checks";

describe("parseAmount", () => {
  it("reads both decimal conventions", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("12,99")).toBe(12.99);
    expect(parseAmount("1,234")).toBe(1234);
    expect(parseAmount("0")).toBeNull();
  });
});

describe("extractPrice", () => {
  it("prefers structured data over visible text", () => {
    const html = '<script type="application/ld+json">{"offers":{"price":"19.90","priceCurrency":"EUR"}}</script>';
    expect(extractPrice(html, "Was $25.00")).toEqual({ amount: 19.9, currency: "EUR", source: "json-ld" });
  });

  it("reads a product meta tag", () => {
    const html = '<meta property="product:price:amount" content="8.5"><meta property="product:price:currency" content="GBP">';
    expect(extractPrice(html, "")).toEqual({ amount: 8.5, currency: "GBP", source: "meta" });
  });

  it("falls back to the first price in the text", () => {
    expect(extractPrice("", "Plan Pro — $49.00 per month")).toEqual({ amount: 49, currency: "USD", source: "text" });
  });

  it("returns null when no price is present", () => {
    expect(extractPrice("<p>Contact us</p>", "Contact us")).toBeNull();
  });
});

describe("changedLines and keywords", () => {
  it("reports only the lines that appeared or disappeared", () => {
    const before = "Plan Basic\nPrice $10\nFooter";
    const after = "Plan Basic\nPrice $12\nFooter";
    expect(changedLines(before, after)).toEqual({ added: ["Price $12"], removed: ["Price $10"] });
  });

  it("matches a keyword watch only when a changed line names a keyword", () => {
    expect(matchesKeywords(["New pricing page"], ["pricing"])).toBe(true);
    expect(matchesKeywords(["Cookie banner text"], ["pricing"])).toBe(false);
    expect(matchesKeywords(["anything"], [])).toBe(true);
  });
});

describe("agent parameters", () => {
  it("defines exactly the three free services", () => {
    expect(AGENT_NAMES).toEqual(["price-watch", "web-watch", "competitor-monitor"]);
  });

  it("rejects an empty url list and unknown fields", () => {
    expect(agentSchemas["price-watch"].safeParse({ urls: [] }).success).toBe(false);
    expect(agentSchemas["price-watch"].safeParse({ urls: ["https://example.com"], prompt: "x" }).success).toBe(false);
  });

  it("applies the defaults for the competitor monitor", () => {
    const parsed = agentSchemas["competitor-monitor"].parse({ domain: "https://example.com" });
    expect(parsed.sections).toEqual(["/pricing", "/blog", "/changelog"]);
    expect(parsed.frequency).toBe("weekly");
  });

  it("requires sections to start with a slash", () => {
    expect(agentSchemas["competitor-monitor"].safeParse({ domain: "https://example.com", sections: ["pricing"] }).success).toBe(false);
  });
});
