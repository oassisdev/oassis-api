import { describe, expect, it } from "vitest";
import { scrapeRequest } from "../src/schema";

/**
 * `block.urlPatterns` are regular expressions, and the obvious guess is a glob. `*.svg`
 * is not a valid regex — "Nothing to repeat" — and sent as one it did not fail cleanly:
 * the render hung for sixty seconds and came back 502. A minute of browser time spent
 * telling the caller nothing.
 *
 * Found by paying for every parameter of scrape with a wallet: it was the one case of
 * thirty-two that behaved differently from the rest.
 */
const parse = (block: unknown) =>
  scrapeRequest.safeParse({ url: "https://oassis.dev", formats: ["markdown"], block });

describe("block.urlPatterns", () => {
  it("accepts a real regular expression", () => {
    for (const p of ["\\.svg$", ".*\\.svg", "^https://cdn\\."]) {
      expect(parse({ urlPatterns: [p] }).success, p).toBe(true);
    }
  });

  it("refuses a glob before anything opens a browser", () => {
    const r = parse({ urlPatterns: ["*.svg"] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain("regexes, not globs");
    }
  });

  it("refuses it even when a valid one comes first", () => {
    expect(parse({ urlPatterns: ["\\.svg$", "*.png"] }).success).toBe(false);
  });

  it("leaves resourceTypes alone", () => {
    expect(parse({ resourceTypes: ["image", "font"] }).success).toBe(true);
  });
});
