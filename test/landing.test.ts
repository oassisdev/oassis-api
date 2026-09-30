import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { landing, robotsTxt, sitemapXml } from "../src/landing";
import { PER_FORMAT, PRICES, inDollars, mapPrice } from "../src/billing/prices";
import type { Env } from "../src/types";

function ctx(host = "oassis.dev"): Context<{ Bindings: Env }> {
  return {
    req: { url: `https://${host}/`, path: "/" },
    env: { BASE_URL: "https://api.oassis.dev" },
  } as unknown as Context<{ Bindings: Env }>;
}

describe("the page for a person", () => {
  const html = landing(ctx());

  /**
   * A page that quotes a price the API does not charge is worse than no page: it is a
   * promise the first invoice breaks.
   */
  it("quotes the prices the API actually charges", () => {
    for (const price of [
      inDollars(PER_FORMAT.markdown),
      inDollars(PRICES.document),
      inDollars(PRICES.cacheHit),
      inDollars(mapPrice(false)),
      inDollars(PRICES.sessionOpen),
      inDollars(PRICES.action),
    ]) {
      expect(html, price).toContain(price);
    }
  });

  it("carries what a search engine reads", () => {
    expect(html).toMatch(/<title>[^<]*scraping[^<]*<\/title>/i);
    expect(html).toMatch(/<meta name="description" content="[^"]{80,}"/);
    expect(html).toContain('<link rel="canonical" href="https://oassis.dev/">');
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('property="og:title"');
  });

  it("says the words somebody would search for", () => {
    for (const word of ["scraping", "crawl", "browser", "markdown", "agents"]) {
      expect(html.toLowerCase(), word).toContain(word);
    }
  });

  it("leads with what the competition cannot say", () => {
    expect(html).toContain("No API key");
    expect(html).toContain("No signup");
  });

  it("gives a request that can be pasted, against the API host", () => {
    expect(html).toContain("curl -X POST https://api.oassis.dev/web/v1/scrape");
    expect(html).toContain("https://api.oassis.dev/mcp");
  });

  it("is written in English, like everything a client reads", () => {
    expect(html).not.toMatch(/[áéíóúñ¿¡]|\b(gratis|precio|llamada|navegador)\b/i);
  });
});

describe("what crawlers ask for first", () => {
  it("lets them in and points at the sitemap", () => {
    const txt = robotsTxt(ctx());
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Sitemap: https://oassis.dev/sitemap.xml");
  });

  it("lists the pages worth indexing", () => {
    const xml = sitemapXml(ctx());
    expect(xml).toContain("<loc>https://oassis.dev/</loc>");
    expect(xml).toContain("/llms.txt");
    expect(xml).toContain("/openapi.json");
  });
});
