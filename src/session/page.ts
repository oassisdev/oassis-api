/**
 * Pulling formats out of a page that is ALREADY open (a browser session).
 *
 * It produces exactly the same response shape as the session-less path: the
 * blocks coming out of the browser imitate the ones from the `scrape` action, so
 * `mapControls` is the same code on both paths and `controls` cannot drift
 * between them.
 */

import type { PDFOptions, Page } from "@cloudflare/puppeteer";
import { mapControls, CONTROL_SELECTORS } from "../controls";
import type { Format, ScrapeResponse } from "../types";
import type { ScrapeRequest } from "../schema";

/** Match cap per selector: a listing page has thousands. */
const MAX_MATCHES_PER_SELECTOR = 300;

/**
 * Runs INSIDE the page, so it cannot use anything from this module, and returns
 * a string: `page.evaluate` only guarantees primitive types.
 */
const BLOCKS_SCRIPT = function (selectors: string[], cap: number): string {
  const doc: any = (globalThis as any).document;
  const blocks = selectors.map((selector) => {
    let nodes: any[] = [];
    try {
      nodes = Array.prototype.slice.call(doc.querySelectorAll(selector), 0, cap);
    } catch {
      return { selector, results: [] };
    }
    const results = nodes.map((n: any) => {
      const r = n.getBoundingClientRect();
      const attributes = Array.prototype.map.call(n.attributes ?? [], (a: any) => ({
        name: a.name,
        value: a.value,
      }));
      return {
        text: (n.innerText ?? n.textContent ?? "").slice(0, 500),
        html: (n.innerHTML ?? "").slice(0, 500),
        attributes,
        // Document coordinates: they survive the page being scrolled.
        top: r.top + (doc.documentElement.scrollTop || 0),
        left: r.left + (doc.documentElement.scrollLeft || 0),
        width: r.width,
        height: r.height,
      };
    });
    return { selector, results };
  });
  return JSON.stringify(blocks);
};

async function blocks(page: Page, selectors: string[]): Promise<unknown> {
  const json = (await page.evaluate(BLOCKS_SCRIPT, selectors, MAX_MATCHES_PER_SELECTOR)) as string;
  return JSON.parse(json);
}

function base64(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

/**
 * A click that submits a form navigates, and a read that lands mid-navigation dies
 * with "Execution context was destroyed". It is a race, not a broken page, so each
 * format gets one retry after waiting for the document to settle.
 */
const NAVIGATION_RACE = /Execution context was destroyed|Target closed|Cannot find context/i;

async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(() => (globalThis as any).document?.readyState === "complete", { timeout: 5_000 })
    .catch(() => null);
}

async function readOnce<T>(page: Page, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (!NAVIGATION_RACE.test(e instanceof Error ? e.message : String(e))) throw e;
    await settle(page);
    return read();
  }
}

/** Converts already-rendered html through Quick Actions (one extra render). */
export type FromHtml = (action: "markdown" | "json", options: Record<string, unknown>) => Promise<unknown>;

/**
 * Pulls every requested format out of the open page. Partial failure works the
 * same as on the session-less path: what came out goes to `data`, what failed
 * goes to `errors`.
 */
export async function formatsFromPage(
  page: Page,
  req: ScrapeRequest,
  fromHtml: FromHtml,
): Promise<Pick<ScrapeResponse, "data" | "errors">> {
  const formats = [...new Set(req.formats)];
  const data: Partial<Record<Format, unknown>> = {};
  const errors: Partial<Record<Format, string>> = {};

  // The html is fetched once and reused by markdown and json.
  let html: string | undefined;
  const pageHtml = async () => (html ??= await readOnce(page, () => page.content()));

  for (const format of formats) {
    try {
      switch (format) {
        case "html":
          data.html = await pageHtml();
          break;
        case "markdown":
          data.markdown = await fromHtml("markdown", { html: await pageHtml() });
          break;
        case "json":
          data.json = await fromHtml("json", {
            html: await pageHtml(),
            ...(req.json?.prompt ? { prompt: req.json.prompt } : {}),
            ...(req.json?.schema
              ? { response_format: { type: "json_schema", json_schema: req.json.schema } }
              : {}),
          });
          break;
        case "controls":
          data.controls = mapControls(
            await readOnce(page, () => blocks(page, CONTROL_SELECTORS.map((s) => s.selector))),
            req.controls,
          );
          break;
        case "elements":
          data.elements = await readOnce(page, () => blocks(page, req.selectors ?? []));
          break;
        case "links": {
          const raw = (await readOnce(page, () =>
            page.evaluate(() => {
            const doc: any = (globalThis as any).document;
            // `a.href` already comes back absolute from the browser.
              return JSON.stringify(
                Array.prototype.map.call(doc.querySelectorAll("a[href]"), (a: any) => a.href),
              );
            }),
          )) as string;
          let list = JSON.parse(raw) as string[];
          if (req.links?.excludeExternal) {
            const host = new URL(page.url()).host;
            list = list.filter((l) => {
              try {
                return new URL(l).host === host;
              } catch {
                return false;
              }
            });
          }
          data.links = list;
          break;
        }
        case "screenshot": {
          const { selector, viewport, ...options } = req.screenshot ?? {};
          if (viewport) await page.setViewport(viewport);
          const target = selector ? await page.$(selector) : page;
          if (!target) throw new Error(`No element matches \`${selector}\`.`);
          data.screenshot = base64((await target.screenshot(options)) as Uint8Array);
          break;
        }
        case "pdf":
          data.pdf = base64((await page.pdf((req.pdf ?? {}) as PDFOptions)) as Uint8Array);
          break;
        case "accessibility":
          data.accessibility = await readOnce(page, () => page.accessibility.snapshot());
          break;
      }
    } catch (e) {
      errors[format] = e instanceof Error ? e.message : String(e);
    }
  }

  return { data, errors };
}
