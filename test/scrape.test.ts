import { describe, expect, it } from "vitest";
import { scrapeRequest } from "../src/schema";
import { scrape } from "../src/scrape";
import { RenderError, type Action, type Renderer } from "../src/types";

/** Fake renderer: records which actions and options it is asked for. */
function fake(
  answer: (action: Action, options: Record<string, unknown>) => unknown,
): Renderer & { calls: { action: Action; options: Record<string, unknown> }[] } {
  const calls: { action: Action; options: Record<string, unknown> }[] = [];
  return {
    calls,
    async run(action, options) {
      calls.push({ action, options });
      const value = answer(action, options);
      if (value instanceof Error) throw value;
      return { value, browserMs: 100 };
    },
  };
}

const parse = (v: unknown) => scrapeRequest.parse(v);

describe("validation", () => {
  it("requires url or html", () => {
    expect(() => parse({ formats: ["markdown"] })).toThrow(/`url` or `html`/);
    expect(() => parse({ url: "https://a.com", html: "<p>x</p>" })).toThrow(/mutually exclusive/);
  });

  it("defaults to markdown", () => {
    expect(parse({ url: "https://a.com" }).formats).toEqual(["markdown"]);
  });

  it("ties selectors to the elements format and prompt/schema to json", () => {
    expect(() => parse({ url: "https://a.com", formats: ["elements"] })).toThrow(/selectors/);
    expect(() => parse({ url: "https://a.com", formats: ["json"] })).toThrow(/prompt/);
  });

  it("rejects what does not exist yet, with a reason", () => {
    expect(() => parse({ url: "https://a.com", binaryAs: "url" })).toThrow(/base64/);
    expect(() =>
      parse({ url: "https://a.com", formats: ["json"], json: { prompt: "x", model: "gpt" } }),
    ).toThrow(/model/);
  });
});

describe("scrape", () => {
  it("one render per format, with its options translated", async () => {
    const r = fake((action) => (action === "links" ? ["https://a.com/1"] : "content"));
    const res = await scrape(
      parse({
        url: "https://a.com",
        formats: ["markdown", "links", "elements"],
        selectors: ["h1"],
        wait: { until: "networkidle0", timeout: 5000 },
      }),
      r,
    );

    expect(r.calls.map((c) => c.action).sort()).toEqual(["links", "markdown", "scrape"]);
    expect(res.metadata.renders).toBe(3);
    expect(res.metadata.browserMsUsed).toBe(300);
    const scrapeCall = r.calls.find((c) => c.action === "scrape");
    expect(scrapeCall?.options.elements).toEqual([{ selector: "h1" }]);
    expect(scrapeCall?.options.gotoOptions).toEqual({ waitUntil: "networkidle0", timeout: 5000 });
  });

  it("one failing format does not take the others down", async () => {
    const r = fake((action) => (action === "json" ? new RenderError("model timeout", 40) : "ok"));
    const res = await scrape(
      parse({ url: "https://a.com", formats: ["markdown", "json"], json: { prompt: "price" } }),
      r,
    );

    expect(res.success).toBe(true);
    expect(res.data.markdown).toBe("ok");
    expect(res.errors.json).toBe("model timeout");
    expect(res.metadata.browserMsUsed).toBe(140);
  });

  it("if not a single one comes out, success is false", async () => {
    const res = await scrape(parse({ url: "https://a.com" }), fake(() => new RenderError("boom")));
    expect(res.success).toBe(false);
    expect(res.errors.markdown).toBe("boom");
  });

  it("excludeExternal keeps only links on the same host", async () => {
    const r = fake(() => ["https://a.com/1", "https://other.com/2", "/relative"]);
    const res = await scrape(
      parse({ url: "https://a.com", formats: ["links"], links: { excludeExternal: true } }),
      r,
    );
    expect(res.data.links).toEqual(["https://a.com/1", "/relative"]);
  });

  it("pulls the title out of the html when it was requested", async () => {
    const r = fake(() => "<html><head><title> Product X </title></head></html>");
    const res = await scrape(parse({ url: "https://a.com", formats: ["html"] }), r);
    expect(res.metadata.title).toBe("Product X");
  });
});
