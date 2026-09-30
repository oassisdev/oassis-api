/**
 * Request validation. One schema: when something does not fit, the client gets a
 * 400 saying exactly which field and why, instead of a failure halfway through a
 * render it already paid for.
 */

import { z } from "zod";
import { FORMATS } from "./types";
import { pageAction } from "./session/actions";

const viewport = z
  .object({
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    deviceScaleFactor: z.number().min(0.1).max(3).optional(),
  })
  .strict();

const cookie = z
  .object({
    name: z.string().min(1),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
  })
  .strict();

export const scrapeRequest = z
  .object({
    url: z.string().url().optional(),
    html: z.string().min(1).optional(),
    formats: z.array(z.enum(FORMATS)).min(1).max(FORMATS.length).default(["markdown"]),
    selectors: z.array(z.string().min(1)).min(1).optional(),
    json: z
      .object({
        prompt: z.string().min(1).optional(),
        schema: z.record(z.unknown()).optional(),
        model: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    screenshot: z
      .object({
        fullPage: z.boolean().optional(),
        type: z.enum(["png", "jpeg", "webp"]).optional(),
        quality: z.number().int().min(1).max(100).optional(),
        omitBackground: z.boolean().optional(),
        selector: z.string().min(1).optional(),
        viewport: viewport.optional(),
      })
      .strict()
      .optional(),
    pdf: z
      .object({
        // Real paper sizes only: a made-up value fails the render at the very end,
        // after the navigation has already been paid for.
        format: z
          .enum(["letter", "legal", "tabloid", "ledger", "a0", "a1", "a2", "a3", "a4", "a5", "a6"])
          .optional(),
        landscape: z.boolean().optional(),
        printBackground: z.boolean().optional(),
        scale: z.number().min(0.1).max(2).optional(),
      })
      .strict()
      .optional(),
    controls: z
      .object({
        visibleOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      })
      .strict()
      .optional(),
    links: z
      .object({
        visibleOnly: z.boolean().optional(),
        excludeExternal: z.boolean().optional(),
      })
      .strict()
      .optional(),
    wait: z
      .object({
        until: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional(),
        selector: z.string().min(1).optional(),
        timeout: z.number().int().min(100).max(60_000).optional(),
      })
      .strict()
      .optional(),
    request: z
      .object({
        headers: z.record(z.string()).optional(),
        cookies: z.array(cookie).optional(),
        userAgent: z.string().min(1).optional(),
        auth: z.object({ username: z.string(), password: z.string() }).strict().optional(),
      })
      .strict()
      .optional(),
    block: z
      .object({
        resourceTypes: z.array(z.string().min(1)).optional(),
        urlPatterns: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    /**
     * How old an answer you are willing to accept, in milliseconds. Left out, the
     * page is rendered fresh: an agent asking for a page expects today's page
     * unless it says otherwise. A cache hit costs $0.0002 instead of the format's
     * price, and the saving shows up in the price before any work happens.
     */
    maxAge: z.number().int().min(0).max(7 * 24 * 60 * 60 * 1000).optional(),
    binaryAs: z.enum(["base64", "url"]).default("base64"),
    viewport: viewport.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (!v.url && !v.html) fail("Either `url` or `html` is required.", ["url"]);
    if (v.url && v.html) fail("`url` and `html` are mutually exclusive: send one.", ["html"]);

    if (v.formats.includes("elements") && !v.selectors)
      fail("The `elements` format needs `selectors`.", ["selectors"]);
    if (v.selectors && !v.formats.includes("elements"))
      fail("`selectors` is only used with the `elements` format.", ["selectors"]);

    if (v.formats.includes("json") && !v.json?.prompt && !v.json?.schema)
      fail("The `json` format needs `json.prompt` or `json.schema`.", ["json"]);
    if (v.json?.model)
      fail("`json.model` is not available yet: the service picks the model.", ["json", "model"]);

    if (v.screenshot?.quality && v.screenshot.type === "png")
      fail("`quality` is not compatible with `png`: use `jpeg` or `webp`.", ["screenshot", "quality"]);

    // `url` means storing the binary somewhere (R2 plus a signed link). Without
    // that, promising it would mean handing out a broken link.
    if (v.binaryAs === "url")
      fail('`binaryAs: "url"` is not available yet; use `base64`.', ["binaryAs"]);
  });

export type ScrapeRequest = z.infer<typeof scrapeRequest>;

/**
 * Opening a session: same request, except `formats` defaults to `controls`
 * —whoever opens a session wants to know what they can press— and `html` makes
 * no sense, because a session navigates.
 */
export const sessionRequest = scrapeRequest
  .innerType()
  .extend({ formats: z.array(z.enum(FORMATS)).min(1).max(FORMATS.length).default(["controls"]) })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (!v.url) fail("A session needs `url`.", ["url"]);
    if (v.html) fail("`html` does not apply to a session: use `url`.", ["html"]);
    if (v.formats.includes("elements") && !v.selectors)
      fail("The `elements` format needs `selectors`.", ["selectors"]);
    if (v.formats.includes("json") && !v.json?.prompt && !v.json?.schema)
      fail("The `json` format needs `json.prompt` or `json.schema`.", ["json"]);
  });

/** Acting on an open session and looking at the result. */
export const actRequest = z
  .object({
    sessionId: z.string().min(1),
    actions: z.array(pageAction).min(1).max(25),
  })
  .passthrough()
  .superRefine((v, ctx) => {
    // The remaining fields are the same as /scrape and are validated with the
    // same schema. The placeholder url is only there so it does not fail for a
    // missing one: acting never navigates unless a `navigate` action says so.
    const { sessionId: _s, actions: _a, ...rest } = v as Record<string, unknown>;
    const check = sessionRequest.safeParse({
      ...rest,
      url: rest.url ?? "https://placeholder.invalid",
    });
    if (!check.success) for (const i of check.error.issues) ctx.addIssue(i);
  });


/**
 * Formats a batch will not take. A batch keeps every result until it is collected,
 * and a base64 screenshot or PDF per URL turns that into megabytes of stored job.
 * Ask for those one URL at a time, where they stream straight back.
 */
const TOO_HEAVY_FOR_BATCH = ["screenshot", "pdf"] as const;

/**
 * A batch: the same request, but with many urls and no single `url`. It answers
 * with a `jobId` instead of the work, because dozens of pages do not fit in one
 * request.
 */
export const batchRequest = scrapeRequest
  .innerType()
  .omit({ url: true, html: true })
  .extend({ urls: z.array(z.string().url()).min(2).max(50) })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    const heavy = v.formats.filter((f) => (TOO_HEAVY_FOR_BATCH as readonly string[]).includes(f));
    if (heavy.length)
      fail(
        `A batch does not take ${heavy.join(" or ")}: every result is kept until you collect it. Ask for those one url at a time on /scrape.`,
        ["formats"],
      );

    if (v.formats.includes("elements") && !v.selectors)
      fail("The `elements` format needs `selectors`.", ["selectors"]);
    if (v.formats.includes("json") && !v.json?.prompt && !v.json?.schema)
      fail("The `json` format needs `json.prompt` or `json.schema`.", ["json"]);

    if (new Set(v.urls).size !== v.urls.length)
      fail("The same url appears twice: a batch charges per url.", ["urls"]);
  });

export type BatchRequest = z.infer<typeof batchRequest>;

/** Filters shared by map and crawl: what belongs to the site and what is wanted. */
const siteFilters = {
  includeSubdomains: z.boolean().optional(),
  includePaths: z.array(z.string().min(1)).max(20).optional(),
  excludePaths: z.array(z.string().min(1)).max(20).optional(),
};

/**
 * `map`: the urls of a site. The sitemap costs no browser, so most of the answer is
 * free to produce; the page itself is one render and can be turned off.
 */
export const mapRequest = z
  .object({
    url: z.string().url(),
    limit: z.number().int().min(1).max(5_000).default(1_000),
    /** Render the page too, to catch what the sitemap does not list. */
    includePage: z.boolean().optional(),
    /** Keep only urls containing this text. */
    search: z.string().min(1).max(200).optional(),
    ...siteFilters,
  })
  .strict();

export type MapRequest = z.infer<typeof mapRequest>;

/**
 * `crawl`: follow the links of a site and read every page. It answers with a `jobId`,
 * and `limit` is required in spirit —it has a default— because a crawl is charged up
 * front for the pages it is allowed to read, and refunds the ones it does not.
 */
export const crawlRequest = scrapeRequest
  .innerType()
  .omit({ url: true, html: true })
  .extend({
    url: z.string().url(),
    /** Pages this crawl may read. Charged up front; what is not read comes back. */
    limit: z.number().int().min(1).max(200).default(25),
    /** How far from the starting page to follow links. */
    maxDepth: z.number().int().min(0).max(5).default(2),
    ...siteFilters,
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    const heavy = v.formats.filter((f) => (TOO_HEAVY_FOR_BATCH as readonly string[]).includes(f));
    if (heavy.length)
      fail(
        `A crawl does not take ${heavy.join(" or ")}: every page is kept until you collect it. Ask for those one url at a time on /scrape.`,
        ["formats"],
      );
    if (v.formats.includes("elements") && !v.selectors)
      fail("The `elements` format needs `selectors`.", ["selectors"]);
    if (v.formats.includes("json") && !v.json?.prompt && !v.json?.schema)
      fail("The `json` format needs `json.prompt` or `json.schema`.", ["json"]);
  });

export type CrawlRequest = z.infer<typeof crawlRequest>;

/**
 * `search`: a query instead of a url. Served at `/search/exa` because the engine is part
 * of what you are buying — the price is Exa's, and hiding whose index answered would
 * make that impossible to check.
 */
export const searchRequest = z
  .object({
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(50).default(10),
    /** Text snippets alongside each result. On by default: a bare url is rarely enough. */
    snippets: z.boolean().optional(),
    domains: z.array(z.string().min(1)).max(20).optional(),
    excludeDomains: z.array(z.string().min(1)).max(20).optional(),
    /** Only results published after this date (ISO). */
    since: z.string().min(4).max(30).optional(),
  })
  .strict();

export type SearchRequest = z.infer<typeof searchRequest>;
