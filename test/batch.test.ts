import { describe, expect, it } from "vitest";
import { batchRequest } from "../src/schema";
import { batchPrice, scrapePrice, PRICES } from "../src/billing/prices";
import { priceOfRequest } from "../src/billing/prices";

const urls = ["https://a.com", "https://b.com", "https://c.com"];

describe("batch validation", () => {
  it("takes urls instead of url", () => {
    const v = batchRequest.parse({ urls, formats: ["markdown"] });
    expect(v.urls).toHaveLength(3);
    expect(batchRequest.safeParse({ url: "https://a.com", formats: ["markdown"] }).success).toBe(false);
  });

  it("needs at least two urls and no more than fifty", () => {
    expect(batchRequest.safeParse({ urls: ["https://a.com"] }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => `https://a.com/${i}`);
    expect(batchRequest.safeParse({ urls: many }).success).toBe(false);
  });

  it("rejects a repeated url, because a batch charges per url", () => {
    const r = batchRequest.safeParse({ urls: ["https://a.com", "https://a.com"] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/twice/);
  });

  it("refuses screenshot and pdf, and says where to ask for them", () => {
    const r = batchRequest.safeParse({ urls, formats: ["markdown", "pdf"] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/one url at a time/);
  });

  it("inherits the rules of /scrape", () => {
    expect(batchRequest.safeParse({ urls, formats: ["elements"] }).success).toBe(false);
    expect(batchRequest.safeParse({ urls, formats: ["json"] }).success).toBe(false);
    expect(batchRequest.safeParse({ urls, formats: ["json"], json: { prompt: "x" } }).success).toBe(true);
  });
});

describe("batch price", () => {
  it("is one scrape per url, charged up front", () => {
    expect(batchPrice(3, ["markdown"])).toBe(3 * 1_000);
    expect(batchPrice(3, ["markdown", "controls"])).toBe(3 * 2_000);
    expect(priceOfRequest("batch", { urls, formats: ["markdown"] })).toBe(3_000);
  });

  it("an empty list costs nothing, so a malformed body cannot be billed", () => {
    expect(priceOfRequest("batch", { formats: ["markdown"] })).toBe(0);
  });

  it("what the cache saves per url is the difference the job refunds", () => {
    // A url served from the cache was charged a full render and cost none.
    expect(scrapePrice(["markdown"]) - PRICES.cacheHit).toBe(800);
  });
});
