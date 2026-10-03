/**
 * Turns a /web/v1/scrape request into N renders, fires them in parallel and
 * assembles the response.
 *
 * The rule: a format that fails does not take the others down. What worked goes
 * into `data`, what failed goes into `errors` with its reason, and `success`
 * stays true as long as there is at least one output.
 */

import type { Format, Renderer, ScrapeResponse } from "./types";
import { markdownFromHtml } from "./repair";
import { wordsRunTogether } from "./run-together";
import { RenderError, type Action } from "./types";
import type { ScrapeRequest } from "./schema";
import { CONTROL_SELECTORS, mapControls } from "./controls";
import { contentTypeOf, documentTypeFromUrl, isDocumentContentType, readDocument } from "./documents";
import type { Env } from "./types";

const ACTION_FOR: Record<Format, Action> = {
  html: "content",
  markdown: "markdown",
  links: "links",
  screenshot: "screenshot",
  pdf: "pdf",
  elements: "scrape",
  json: "json",
  accessibility: "accessibilityTree",
  controls: "scrape",
};

/** Options valid for any action: navigation, identity and blocking. */
function commonOptions(req: ScrapeRequest): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (req.url) o.url = req.url;
  if (req.html) o.html = req.html;

  const goto: Record<string, unknown> = {};
  if (req.wait?.until) goto.waitUntil = req.wait.until;
  if (req.wait?.timeout) goto.timeout = req.wait.timeout;
  if (Object.keys(goto).length) o.gotoOptions = goto;
  /**
   * `waitForSelector` takes an object, not a string. Sent as a string it answered
   * "Invalid input: expected object, received string" on every call that used it — so
   * `wait.selector` was documented, accepted by our schema, and broken in every request
   * that reached a browser. The timeout rides along when there is one.
   */
  if (req.wait?.selector) {
    o.waitForSelector = {
      selector: req.wait.selector,
      ...(req.wait.timeout ? { timeout: req.wait.timeout } : {}),
    };
  }

  if (req.viewport) o.viewport = req.viewport;
  if (req.request?.headers) o.setExtraHTTPHeaders = req.request.headers;
  if (req.request?.cookies) o.cookies = req.request.cookies;
  if (req.request?.userAgent) o.userAgent = req.request.userAgent;
  if (req.request?.auth) o.authenticate = req.request.auth;
  if (req.block?.resourceTypes) o.rejectResourceTypes = req.block.resourceTypes;
  if (req.block?.urlPatterns) o.rejectRequestPattern = req.block.urlPatterns;
  return o;
}

/** Adds to the common ones whatever only a single format understands. */
function optionsFor(format: Format, req: ScrapeRequest): Record<string, unknown> {
  const o = commonOptions(req);
  switch (format) {
    case "screenshot": {
      const { selector, viewport, ...shot } = req.screenshot ?? {};
      if (Object.keys(shot).length) o.screenshotOptions = shot;
      if (selector) o.selector = selector;
      // The screenshot's own viewport overrides the general one.
      if (viewport) o.viewport = viewport;
      break;
    }
    case "pdf":
      if (req.pdf) o.pdfOptions = req.pdf;
      break;
    case "links":
      if (req.links?.visibleOnly) o.visibleLinksOnly = true;
      break;
    case "elements":
      o.elements = (req.selectors ?? []).map((selector) => ({ selector }));
      break;
    case "controls":
      o.elements = CONTROL_SELECTORS;
      break;
    case "json":
      if (req.json?.prompt) o.prompt = req.json.prompt;
      if (req.json?.schema) o.response_format = { type: "json_schema", json_schema: req.json.schema };
      break;
    default:
      break;
  }
  return o;
}

/**
 * What this request would render: one action plus its options per format. The
 * billing guard uses it to look the cache up before charging, and the orchestrator
 * uses it to do the work. Same code, so the price cannot describe one plan and the
 * work another.
 */
export function renderPlan(req: ScrapeRequest): { format: Format; action: Action; options: Record<string, unknown> }[] {
  return [...new Set(req.formats)].map((format) => ({
    format,
    action: ACTION_FOR[format],
    options: optionsFor(format, req),
  }));
}

/** Adjustments that depend on the response, not on the provider. */
function postProcess(format: Format, value: unknown, req: ScrapeRequest): unknown {
  if (format === "controls") return mapControls(value, req.controls);
  if (format === "accessibility") {
    const v = value as { accessibilityTree?: unknown };
    return v?.accessibilityTree ?? value;
  }
  if (format === "links" && Array.isArray(value) && req.links?.excludeExternal && req.url) {
    const host = new URL(req.url).host;
    return (value as unknown[]).filter((l) => {
      if (typeof l !== "string") return true;
      try {
        return new URL(l, req.url).host === host;
      } catch {
        return false;
      }
    });
  }
  return value;
}

function titleFrom(data: Partial<Record<Format, unknown>>): string | undefined {
  const html = data.html;
  if (typeof html !== "string") return undefined;
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?.[1]?.trim().slice(0, 300) || undefined;
}

/**
 * Reads a url, whatever it turns out to be.
 *
 * A document is decided in two places. Its extension is free to check, so a `.pdf` goes
 * straight to the converter and never touches a browser. A document with no extension
 * —`/download?id=7`— looks like a page until the page comes back blank, so an empty
 * answer asks the server what it was serving. Without that second check, the caller gets
 * `200` and empty markdown, which is worse than an error because it looks fine.
 */
export async function read(
  req: ScrapeRequest,
  renderer: Renderer,
  env: Env,
): Promise<ScrapeResponse> {
  if (req.url) {
    const byExtension = documentTypeFromUrl(req.url);
    if (byExtension) return readDocument(env, req, byExtension);
  }

  const rendered = await scrape(req, renderer, markdownFromHtml(env));
  if (!req.url || !isEmpty(rendered)) return rendered;

  const contentType = await contentTypeOf(req.url);
  if (!isDocumentContentType(contentType)) return rendered;
  // The browser was already used on this url, so that render is reported and the price
  // stays what it was: a document with no extension is billed as the page we thought it
  // was, and we absorb the difference rather than charging after the fact.
  return readDocument(env, req, contentType!.split(";")[0]!.trim(), rendered.metadata.renders);
}

/** Nothing readable came out, which is the signal that this may not be a page at all. */
function isEmpty(res: ScrapeResponse): boolean {
  const text = [res.data.markdown, res.data.html].find((v) => typeof v === "string") as
    | string
    | undefined;
  if (text === undefined) return false;
  return text.trim().length === 0;
}

/**
 * Converts html to markdown when the renderer's own conversion came back with the words
 * stuck together. The caller supplies it because it needs the AI binding, which this
 * module does not have and should not grow a reason to take.
 */
export type RepairMarkdown = (html: string) => Promise<string | null>;

export async function scrape(
  req: ScrapeRequest,
  renderer: Renderer,
  repair?: RepairMarkdown,
): Promise<ScrapeResponse> {
  const started = Date.now();
  const plan = renderPlan(req);
  const formats = plan.map((p) => p.format);

  const done = await Promise.all(
    plan.map(async ({ format, action, options }) => {
      try {
        const r = await renderer.run(action, options);
        return {
          format,
          ok: true as const,
          value: postProcess(format, r.value, req),
          browserMs: r.browserMs,
          cached: r.cached === true,
        };
      } catch (e) {
        const browserMs = e instanceof RenderError ? e.browserMs : 0;
        return { format, ok: false as const, message: e instanceof Error ? e.message : String(e), browserMs, cached: false };
      }
    }),
  );

  const data: Partial<Record<Format, unknown>> = {};
  const errors: Partial<Record<Format, string>> = {};
  const cached: Format[] = [];
  let browserMsUsed = 0;
  let renders = 0;
  for (const d of done) {
    browserMsUsed += d.browserMs;
    if (d.cached) cached.push(d.format);
    else renders += 1;
    if (d.ok) data[d.format] = d.value;
    else errors[d.format] = d.message;
  }

  /**
   * Second chance for a page whose words came back stuck together.
   *
   * The spaces survive in the html — it is the conversion that drops them — so the fix is
   * to convert it ourselves. Costs us one more render and the caller nothing: they asked
   * for one output and they are charged for one output.
   */
  let repaired: Format[] | undefined;
  if (repair && typeof data.markdown === "string" && wordsRunTogether(data.markdown)) {
    try {
      let html = typeof data.html === "string" ? data.html : null;
      if (!html) {
        const r = await renderer.run(ACTION_FOR.html, optionsFor("html", req));
        browserMsUsed += r.browserMs;
        if (!r.cached) renders += 1;
        html = typeof r.value === "string" ? r.value : null;
      }
      const fixed = html ? await repair(html) : null;
      // Only if it actually fixed it: a second mangled answer is not an improvement.
      if (fixed && fixed.trim() && !wordsRunTogether(fixed)) {
        data.markdown = fixed;
        repaired = ["markdown"];
      }
    } catch {
      // The first answer stands. A failed repair must not take the page down with it.
    }
  }

  const title = titleFrom(data);
  return {
    success: Object.keys(data).length > 0,
    data,
    metadata: {
      url: req.url ?? null,
      formats,
      // Only what actually reached a browser is a render.
      renders,
      ...(cached.length ? { cached } : {}),
      ...(repaired ? { repaired } : {}),
      browserMsUsed,
      ms: Date.now() - started,
      ...(title ? { title } : {}),
    },
    errors,
  };
}
