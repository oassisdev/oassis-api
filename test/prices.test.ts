import { describe, expect, it } from "vitest";
import {
  actPrice,
  inDollars,
  openPrice,
  PRICES,
  priceOfRequest,
  scrapePrice,
  timePrice,
} from "../src/billing/prices";

describe("prices", () => {
  it("one output costs a render, and json costs the model", () => {
    expect(scrapePrice(["markdown"])).toBe(1_000);
    expect(scrapePrice(["json"])).toBe(5_000);
    expect(scrapePrice(["pdf"])).toBe(2_000);
  });

  it("formats add up, and a repeated one is not billed twice", () => {
    expect(scrapePrice(["markdown", "links"])).toBe(2_000);
    expect(scrapePrice(["markdown", "markdown"])).toBe(1_000);
  });

  it("stays above what a render is worth", () => {
    // Cloudflare bills $0.09 per browser hour: about 12.5 micros for half a second.
    const halfSecondOfBrowser = 12.5;
    expect(scrapePrice(["markdown"])).toBeGreaterThan(halfSecondOfBrowser * 10);
    // A browser minute costs 1_500 micros.
    expect(PRICES.sessionMinute).toBeGreaterThan(1_500);
  });

  it("opening a session includes what is read while opening", () => {
    expect(openPrice(["controls"])).toBe(PRICES.sessionOpen + 1_000);
  });

  it("acting costs per action plus what is read afterwards", () => {
    expect(actPrice(3, ["controls"])).toBe(3 * PRICES.action + 1_000);
    expect(actPrice(0, [])).toBe(0);
  });

  it("the first session minute is in the opening and is not billed twice", () => {
    const opened = 1_000_000;
    expect(timePrice(opened, opened + 30_000)).toBe(0);
    expect(timePrice(opened, opened + 59_000)).toBe(0);
    expect(timePrice(opened, opened + 61_000)).toBe(PRICES.sessionMinute);
    expect(timePrice(opened, opened + 150_000)).toBe(2 * PRICES.sessionMinute);
  });

  it("the cost comes out of the request body", () => {
    expect(priceOfRequest("scrape", { formats: ["markdown", "pdf"] })).toBe(3_000);
    expect(priceOfRequest("session", {})).toBe(openPrice(["controls"]));
    expect(priceOfRequest("act", { actions: [1, 2], formats: ["controls"] } as never)).toBe(
      2 * PRICES.action + 1_000,
    );
  });

  it("is shown in dollars without trailing zeros", () => {
    expect(inDollars(1_000)).toBe("$0.001");
    expect(inDollars(20_000)).toBe("$0.02");
    expect(inDollars(1_000_000)).toBe("$1");
    expect(inDollars(0)).toBe("$0");
  });

  it("a charge keeps the sign outside the currency", () => {
    expect(inDollars(-1_000)).toBe("-$0.001");
  });
});
