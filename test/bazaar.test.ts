import { describe, expect, it } from "vitest";
import { BAZAAR } from "../src/billing/bazaar";

/**
 * The registry publishes these examples verbatim and validates each against the schema
 * beside it, discarding the whole resource if one field does not fit. So the examples are
 * checked here: a shop window nobody looked at is how you end up advertising a call that
 * returns 400.
 */
describe("the bazaar extension", () => {
  const entries = Object.entries(BAZAAR);

  it("covers every paid route", () => {
    expect(entries.map(([k]) => k).sort()).toEqual(
      ["act", "batch", "crawl", "map", "scrape", "search", "session"].sort(),
    );
  });

  it("declares a POST with a json body, which is how these routes are called", () => {
    for (const [name, b] of entries) {
      expect(b.info.input.type, name).toBe("http");
      expect(b.info.input.method, name).toBe("POST");
      expect(b.info.input.bodyType, name).toBe("json");
      expect(Object.keys(b.info.input.body).length, name).toBeGreaterThan(0);
      expect(Object.keys(b.info.output.example).length, name).toBeGreaterThan(0);
    }
  });

  /** A url we do not control is a published example we cannot keep working. */
  it("only points examples at urls of ours", () => {
    // Only `info` is the shop window; `schema` carries the json-schema spec url.
    const urls = JSON.stringify(entries.map(([, b]) => b.info)).match(/https?:\/\/[^"\\]+/g) ?? [];
    for (const u of urls) {
      const ours = u.includes("oassis.dev") || u.includes("modelcontextprotocol.io");
      expect(ours, `${u} is published as an example and is not ours`).toBe(true);
    }
  });

  it("is serialisable, because it travels inside a header", () => {
    for (const [name, b] of entries) {
      const round = JSON.parse(JSON.stringify(b));
      expect(round, name).toEqual(b);
      expect(JSON.stringify(b).length, `${name} is large for a header`).toBeLessThan(4000);
    }
  });
});
