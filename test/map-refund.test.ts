import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A map that found nothing is work that did not happen, and the front page promises it
 * is not charged for. It was: mapping a domain that does not resolve cost $0.0003 and
 * answered 200 with an empty list, while scrape in the same situation refunded and
 * answered 502. Found by exercising every parameter of web_map, not by a complaint.
 *
 * Asserted on the source because the alternative is a live call with real money, and the
 * thing that broke was a missing branch rather than a wrong number.
 */
describe("a map that finds nothing", () => {
  it("refunds and does not answer 200, over HTTP", () => {
    const src = readFileSync("src/index.ts", "utf8");
    const route = src.slice(src.indexOf('bothPaths("map")'));
    expect(route).toContain('refund(c, "refund: nothing to map")');
    expect(route.slice(0, route.indexOf("});"))).toContain("502");
  });

  it("refunds over MCP too, and says it is an error", () => {
    const src = readFileSync("src/mcp.ts", "utf8");
    const tool = src.slice(src.indexOf('name === "web_map"'));
    expect(tool).toContain('giveBack("refund: nothing to map")');
    expect(tool).toContain("res.urls.length === 0");
  });

  /** The rule has to be the same on both doors, which is how this one slipped. */
  it("keeps scrape's refund, which was the one doing it right", () => {
    expect(readFileSync("src/index.ts", "utf8")).toContain('refund(c, "refund: nothing came back")');
    expect(readFileSync("src/mcp.ts", "utf8")).toContain('giveBack("refund: nothing came back")');
  });
});
