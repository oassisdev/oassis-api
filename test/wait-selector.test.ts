import { describe, expect, it } from "vitest";
import { renderPlan } from "../src/scrape";

/**
 * `wait.selector` was passed to the renderer as a string, which answers
 * "Invalid input: expected object, received string". It was documented, accepted by our
 * schema, and broken in every request that used it — found by exercising every parameter
 * of web_scrape in order rather than by anybody reporting it.
 */
describe("waiting for a selector", () => {
  const options = (wait: unknown) =>
    renderPlan({ url: "https://oassis.dev", formats: ["markdown"], wait } as never)[0]!.options;

  it("sends an object, not the bare string", () => {
    const o = options({ selector: "h1" }) as { waitForSelector?: unknown };
    expect(typeof o.waitForSelector, "a string here fails every call").toBe("object");
    expect(o.waitForSelector).toEqual({ selector: "h1" });
  });

  it("carries the timeout when there is one", () => {
    const o = options({ selector: "h1", timeout: 15_000 }) as { waitForSelector?: unknown };
    expect(o.waitForSelector).toEqual({ selector: "h1", timeout: 15_000 });
  });

  it("sends nothing when no selector was asked for", () => {
    const o = options({ until: "load" }) as { waitForSelector?: unknown };
    expect(o.waitForSelector).toBeUndefined();
  });
});
