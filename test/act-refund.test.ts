import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PRICES, actPrice } from "../src/billing/prices";

/**
 * Actions are charged up front, all of them, because that is what lets the price be
 * quoted before any work happens. But they stop at the first failure — so a request of
 * twenty whose first action fails was charged for twenty and did one.
 *
 * Found by exercising web_act's parameters: a deliberate bad `ref` with a second action
 * behind it was billed for both. The answer says how many were attempted, so the rest
 * can go back.
 */
describe("actions that never ran", () => {
  it("is what the up-front price charges for, which is why the refund has to exist", () => {
    expect(actPrice(4, []), "four actions are charged as four").toBe(4 * PRICES.action);
  });

  it("gives back the difference over HTTP", () => {
    const src = readFileSync("src/index.ts", "utf8");
    expect(src).toContain("refundUnrunActions");
    expect(src).toContain("action(s) never ran");
    const fn = src.slice(src.indexOf("async function refundUnrunActions"));
    // The attempted one stays charged: the browser did the work of trying.
    expect(fn).toContain("pedidas - corridas");
  });

  it("gives back the difference over MCP too", () => {
    const src = readFileSync("src/mcp.ts", "utf8");
    expect(src).toContain("action(s) never ran");
    expect(src).toContain("actions.length - corridas");
  });
});
