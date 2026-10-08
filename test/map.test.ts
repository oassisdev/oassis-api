import { describe, expect, it } from "vitest";
import { keepUrl } from "../src/map";
import { crawlRequest, mapRequest } from "../src/schema";
import { MIN_CHARGE, crawlPagePrice, crawlPrice, mapPrice, priceOfRequest } from "../src/billing/prices";

const base = (extra: Record<string, unknown> = {}) =>
  mapRequest.parse({ url: "https://a.com/start", ...extra });

describe("which urls belong to the map", () => {
  it("keeps the same host and drops the rest", () => {
    expect(keepUrl("https://a.com/x", base())).toBe("https://a.com/x");
    expect(keepUrl("/relative", base())).toBe("https://a.com/relative");
    expect(keepUrl("https://other.com/x", base())).toBeNull();
    expect(keepUrl("https://sub.a.com/x", base())).toBeNull();
  });

  it("subdomains only when asked", () => {
    expect(keepUrl("https://sub.a.com/x", base({ includeSubdomains: true }))).toBe("https://sub.a.com/x");
  });

  it("drops what is not a page", () => {
    expect(keepUrl("mailto:hi@a.com", base())).toBeNull();
    expect(keepUrl("javascript:alert(1)", base())).toBeNull();
    expect(keepUrl("tel:+34600000000", base())).toBeNull();
    expect(keepUrl("https://", base())).toBeNull();
    // Text with no scheme is a relative link and does resolve against the site,
    // which is what a browser would do with it too.
    expect(keepUrl("some page", base())).toBe("https://a.com/some%20page");
  });

  it("a fragment is not a different page", () => {
    expect(keepUrl("https://a.com/x#section", base())).toBe("https://a.com/x");
  });

  it("honours include, exclude and search", () => {
    const req = base({ includePaths: ["/docs/"], excludePaths: ["/docs/old/"] });
    expect(keepUrl("https://a.com/docs/new", req)).toBe("https://a.com/docs/new");
    expect(keepUrl("https://a.com/blog/new", req)).toBeNull();
    expect(keepUrl("https://a.com/docs/old/x", req)).toBeNull();

    const searching = base({ search: "PRICING" });
    expect(keepUrl("https://a.com/platform/pricing/", searching)).toBe("https://a.com/platform/pricing/");
    expect(keepUrl("https://a.com/platform/limits/", searching)).toBeNull();
  });
});

describe("map price", () => {
  it("the payable floor without the page, one render with it", () => {
    expect(mapPrice(false)).toBe(MIN_CHARGE);
    expect(mapPrice(true)).toBe(1_500);
    expect(priceOfRequest("map", { includePage: false } as never)).toBe(MIN_CHARGE);
    expect(priceOfRequest("map", {} as never)).toBe(1_500);
  });
});

describe("crawl", () => {
  it("has a page budget and a depth, both with defaults", () => {
    const v = crawlRequest.parse({ url: "https://a.com" });
    expect(v.limit).toBe(25);
    expect(v.maxDepth).toBe(2);
    expect(v.formats).toEqual(["markdown"]);
  });

  it("refuses what a job cannot keep, and says where to ask", () => {
    const r = crawlRequest.safeParse({ url: "https://a.com", formats: ["screenshot"] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toMatch(/one url at a time/);
  });

  it("caps the budget and the depth", () => {
    expect(crawlRequest.safeParse({ url: "https://a.com", limit: 500 }).success).toBe(false);
    expect(crawlRequest.safeParse({ url: "https://a.com", maxDepth: 9 }).success).toBe(false);
  });

  it("a page always includes the links, because that is how it finds the next one", () => {
    // markdown + links, not markdown alone.
    expect(crawlPagePrice(["markdown"])).toBe(2_000);
    // Asking for links explicitly does not pay for them twice.
    expect(crawlPagePrice(["markdown", "links"])).toBe(2_000);
    expect(crawlPagePrice(["links"])).toBe(1_000);
  });

  it("is charged up front for every page it is allowed to read", () => {
    expect(crawlPrice(6, ["markdown"])).toBe(12_000);
    expect(priceOfRequest("crawl", { limit: 6, formats: ["markdown"] } as never)).toBe(12_000);
    // No limit means the default of 25.
    expect(priceOfRequest("crawl", { formats: ["markdown"] } as never)).toBe(50_000);
  });
});
