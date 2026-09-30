/**
 * A live browser session, in a Durable Object.
 *
 * The object keeps the browser between requests: that is what makes a `ref` from
 * `controls` still point at the same element on the next call, and what allows
 * clicking, typing and looking again without reloading the page.
 *
 * Cost: here the browser is billed by time open, not by render. Hence the alarm
 * that closes it after `IDLE_MS` without use; without that close, a forgotten
 * session bills until Cloudflare cuts it off.
 */

import { DurableObject } from "cloudflare:workers";
import puppeteer, { type Browser, type Page } from "@cloudflare/puppeteer";
import { formatsFromPage } from "./page";
import { describeAction, resolveRef, type PageAction } from "./actions";
import { closeSession } from "../billing/accounts";
import { timePrice } from "../billing/prices";
import type { Env, ScrapeResponse } from "../types";
import type { ScrapeRequest } from "../schema";

/** With no activity, the session closes. The browser is asked for with this margin. */
const IDLE_MS = 60_000;
const HEARTBEAT_MS = 10_000;

interface Open {
  kind: "open";
  req: ScrapeRequest;
}
interface Act {
  kind: "act";
  actions: PageAction[];
  req: ScrapeRequest;
}
export type Message = Open | Act | { kind: "close" };

export interface SessionResponse extends ScrapeResponse {
  sessionId: string;
  /** Actions that ran, in order, and where it stopped if something failed. */
  actions?: { action: string; ok: boolean; error?: string }[];
}

export class BrowserSession extends DurableObject<Env> {
  private browser?: Browser;
  private page?: Page;
  private lastUsed = Date.now();

  async fetch(request: Request): Promise<Response> {
    const message = (await request.json()) as Message;
    const sessionId = this.ctx.id.toString();

    if (message.kind === "close") {
      const charged = await this.close();
      return Response.json({
        sessionId,
        closed: true,
        ...(charged?.charged ? { chargedMicros: charged.charged } : {}),
      });
    }

    const started = Date.now();
    this.lastUsed = started;
    const ran: SessionResponse["actions"] = [];

    let page: Page;
    try {
      page = await this.livePage(message.req);
      if (message.kind === "open" && message.req.url) {
        await page.goto(message.req.url, {
          waitUntil: message.req.wait?.until ?? "load",
          timeout: message.req.wait?.timeout ?? 30_000,
        });
        if (message.req.wait?.selector) {
          await page.waitForSelector(message.req.wait.selector, {
            timeout: message.req.wait?.timeout ?? 30_000,
          });
        }
      }
    } catch (e) {
      // A url that does not answer, or a browser that will not start, is an error
      // with an explanation, not a 500: the caller has to be able to tell "your
      // url does not load" from "something of ours broke".
      await this.close();
      return Response.json(
        {
          sessionId,
          success: false,
          error: "browser_error",
          message: e instanceof Error ? e.message : String(e),
        },
        { status: 502 },
      );
    }

    if (message.kind === "act") {
      for (const action of message.actions) {
        try {
          await this.perform(page, action);
          ran.push({ action: describeAction(action), ok: true });
        } catch (e) {
          // Stops at the first failure: clicking blind on a page that is not
          // where the agent believes it is would be worse than stopping.
          ran.push({
            action: describeAction(action),
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
          break;
        }
      }
    }

    // After acting, the page may still be navigating (a click that submits a
    // form). Reading formats now would race the navigation, so the document is
    // given a moment to reach `complete` first.
    if (ran.length) {
      await page
        .waitForFunction(() => (globalThis as any).document?.readyState === "complete", {
          timeout: 5_000,
        })
        .catch(() => null);
    }

    // markdown and json are still resolved through Quick Actions over the html we
    // already rendered: that is a separate render and has to be counted.
    let extraRenders = 0;
    const { data, errors } = await formatsFromPage(page, message.req, async (action, options) => {
      extraRenders += 1;
      return this.viaQuickActions(action, options);
    });

    await this.scheduleClose();
    this.lastUsed = Date.now();

    // A failed action is a failure even if formats could be read: the agent asked
    // for something to be clicked and it was not. The formats that did come out
    // stay in `data`, which is what lets it find its bearings again.
    const actionsOk = ran.every((a) => a.ok);
    const response: SessionResponse = {
      sessionId,
      success: actionsOk && (Object.keys(data).length > 0 || message.req.formats.length === 0),
      data,
      metadata: {
        url: page.url(),
        formats: [...new Set(message.req.formats)],
        // In a session you pay for time open, not per render; the only thing
        // counted here are the extra renders for markdown and json.
        renders: extraRenders,
        browserMsUsed: 0,
        ms: Date.now() - started,
      },
      errors,
      ...(ran.length ? { actions: ran } : {}),
    };
    return Response.json(response);
  }

  /** markdown and json still go through Quick Actions, over the rendered html. */
  private async viaQuickActions(
    action: "markdown" | "json",
    options: Record<string, unknown>,
  ): Promise<unknown> {
    const res = await this.env.BROWSER.quickAction(action, options);
    if (!res.ok) throw new Error(`\`${action}\` failed: HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown };
    return body?.result ?? body;
  }

  private async livePage(req: ScrapeRequest): Promise<Page> {
    if (!this.browser?.isConnected()) {
      this.browser = await puppeteer.launch(this.env.BROWSER, { keep_alive: IDLE_MS });
      this.page = undefined;
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.browser.newPage();
      if (req.viewport) await this.page.setViewport(req.viewport);
      if (req.request?.userAgent) await this.page.setUserAgent(req.request.userAgent);
      if (req.request?.headers) await this.page.setExtraHTTPHeaders(req.request.headers);
      if (req.request?.auth) await this.page.authenticate(req.request.auth);
    }
    return this.page;
  }

  private async perform(page: Page, action: PageAction): Promise<void> {
    if ("navigate" in action) {
      await page.goto(action.navigate, { waitUntil: "load" });
      return;
    }
    if ("back" in action) {
      await page.goBack({ waitUntil: "load" });
      return;
    }
    if ("press" in action) {
      await page.keyboard.press(action.press as Parameters<Page["keyboard"]["press"]>[0]);
      return;
    }
    if ("wait" in action) {
      if (action.wait.selector) await page.waitForSelector(action.wait.selector, { timeout: 30_000 });
      if (action.wait.ms) await new Promise((r) => setTimeout(r, action.wait.ms));
      return;
    }
    if ("scroll" in action) {
      const { to, by } = action.scroll;
      await page.evaluate(
        (target: string | undefined, delta: number | undefined) => {
          // Runs in the browser: there `globalThis` is `window`.
          const w = globalThis as any;
          if (target === "top") w.scrollTo(0, 0);
          else if (target === "bottom") w.scrollTo(0, w.document.body.scrollHeight);
          else if (typeof delta === "number") w.scrollBy(0, delta);
        },
        to,
        by,
      );
      return;
    }

    const target = "click" in action ? action.click : "type" in action ? action.type : action.select;
    const element = await this.element(page, target);

    if ("click" in action) {
      await element.click();
      return;
    }
    if ("type" in action) {
      if (action.type.clear) {
        // Selects everything inside the field before typing: `type` appends.
        await element.click({ count: 3 });
        await page.keyboard.press("Backspace");
      }
      await element.type(action.type.text);
      return;
    }
    await element.select(action.select.value);
  }

  /** Resolves a `ref` or a selector to the actual element on the page. */
  private async element(page: Page, target: { ref?: string; selector?: string }) {
    if (!target.ref && !target.selector) throw new Error("Either `ref` or `selector` is required.");
    const { selector, nth } = target.ref
      ? resolveRef(target.ref)
      : { selector: target.selector as string, nth: 0 };
    const found = await page.$$(selector);
    const element = found[nth];
    if (!element) {
      throw new Error(
        `\`${target.ref ?? selector}\` does not exist now: \`${selector}\` has ${found.length} matches. Ask for \`controls\` again.`,
      );
    }
    return element;
  }

  private async scheduleClose(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) == null) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
    }
  }

  /**
   * Beats every 10 s. While there has been recent use it keeps the object (and
   * with it the browser) alive; once the idle window passes it closes and stops
   * billing.
   */
  async alarm(): Promise<void> {
    if (Date.now() - this.lastUsed < IDLE_MS) {
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
      return;
    }
    await this.close();
  }

  private async close(): Promise<{ charged: number } | null> {
    await this.ctx.storage.deleteAlarm();
    // Browser time is billed here, the only moment its duration is known. If the
    // account ran out of balance, it closes anyway.
    let charged: { charged: number } | null = null;
    try {
      charged = await closeSession(this.env.BILLING, this.ctx.id.toString(), (openedAt) =>
        timePrice(openedAt, Date.now()),
      );
    } catch (e) {
      console.error(`session close: could not bill the time: ${e}`);
    }
    try {
      await this.browser?.close();
    } catch {
      /* already closed */
    }
    this.browser = undefined;
    this.page = undefined;
    return charged;
  }
}
