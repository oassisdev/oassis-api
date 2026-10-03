/**
 * oassis-api — web extraction and browser control for agents.
 *
 * One product route per job. The client says in `formats` which outputs it wants
 * and gets them all in the same response. The `/web` prefix leaves room for
 * future families (`/ai/v1`, `/data/v1`) without versioning this one again.
 */

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { badRequest, cacheableDoc, origin, prefixForHost } from "./http";
import {
  actRequest,
  batchRequest,
  crawlRequest,
  mapRequest,
  scrapeRequest,
  searchRequest,
  sessionRequest,
} from "./schema";
import { read, scrape } from "./scrape";
import { QuickActionsRenderer } from "./quick-actions";
import { CachedRenderer } from "./cached-renderer";
import { cacheable } from "./cache";
import type { Env } from "./types";
import { billing, parsedBody } from "./billing";
import { mcp } from "./mcp";
import { account } from "./account";
import { feedback } from "./feedback";
import {
  accountForKey,
  closeSession,
  credit,
  jobOwner,
  registerJob,
  registerSession,
  sessionAccess,
  sessionOwner,
} from "./billing/accounts";
import { PRICES, inDollars } from "./billing/prices";
import { payerFromHeaders, walletIdentity } from "./billing/payer";
import type { Message } from "./session/do";
import type { JobMessage } from "./jobs/do";
import type { CrawlMessage } from "./jobs/crawl";
import { mapSite } from "./map";
import { landing, robotsTxt, sitemapXml, servedText } from "./landing";
import { mountIcon } from "./icon";
import { mountTraceLog } from "./traces";
import { privacyPage, supportPage, termsPage } from "./legal";
import { actDoc, batchDoc, crawlDoc, doc, mapDoc, searchDoc, sessionDoc } from "./docs";
import { llmsTxt, openapi } from "./openapi";
import { mountBackoffice } from "./private/backoffice";
import { ENGINE, search } from "./search/exa";

export { BrowserSession } from "./session/do";
export { BatchJob } from "./jobs/do";
export { CrawlJob } from "./jobs/crawl";

const app = new Hono<{ Bindings: Env }>();

/**
 * The call log, before everything.
 *
 * It was mounted after the billing guard and the MCP route, so it saw neither: a 402 is
 * answered by the guard without ever calling the next handler, and /mcp was matched by a
 * route registered earlier. The log recorded free GETs and nothing else — which is the
 * opposite of what it is for.
 */
mountTraceLog(app);

// Billing first: no product route does any work unpaid.
app.use(billing);

/** Self-describing document: an agent can read the route before using it. */

// The MCP surface, for clients that speak that language (ChatGPT, Claude, agent
// runtimes). The billing guard does not touch it: charging happens inside, on the
// tool call, because `initialize` and `tools/list` have to be free or no client
// could even connect.
app.route("/", mcp);

// Account introspection. Free and outside the billing guard on purpose: asking how
// much money you have left cannot cost money.
app.route("/", account);

// Reporting a bad answer is free: charging for a complaint would mean paying to tell us
// we are broken.
app.route("/", feedback);

/**
 * The front page has two audiences on two hosts. The bare domain is where a person lands,
 * so it answers a page; the API hosts answer the index a client is looking for. Serving the
 * page everywhere would put html in front of an agent that asked for a service description.
 */
app.get("/", (c) => {
  if (isSite(c)) {
    return c.html(landing(c), 200, { "cache-control": "public, max-age=3600" });
  }
  return cacheableDoc(c, {
    service: "oassis-api",
    docs: `${origin(c)}${prefixForHost(c)}/scrape`,
    endpoints: [
      "POST /web/v1/scrape",
      "POST /web/v1/session",
      "POST /web/v1/act",
      "DELETE /web/v1/session/:id",
      "POST /mcp",
      "GET /web/v1/account",
      "GET /web/v1/account/usage",
      "GET /web/v1/account/transactions",
      "GET /web/v1/account/sessions",
      "POST /web/v1/feedback",
      "POST /web/v1/search/exa",
      "POST /web/v1/scrape/batch",
      "GET /web/v1/scrape/batch/:id",
      "DELETE /web/v1/scrape/batch/:id",
      "POST /web/v1/map",
      "POST /web/v1/crawl",
      "GET /web/v1/crawl/:id",
      "DELETE /web/v1/crawl/:id",
    ],
  });
});

/**
 * Every route is served in both shapes: `/web/v1/x` (the umbrella,
 * api.oassis.dev) and `/v1/x` (the family alone, web.oassis.dev). They are real
 * routes, not redirects: the 402 challenge has to come out on the URL the client
 * called, which is the one that ends up published in x402 directories.
 */
const bothPaths = (suffix: string) => [`/web/v1/${suffix}`, `/v1/${suffix}`];

for (const route of bothPaths("scrape")) app.get(route, (c) => cacheableDoc(c, doc(c)));

app.on("POST", bothPaths("scrape"), async (c) => {
  const parsed = scrapeRequest.safeParse(parsedBody(c));
  if (!parsed.success) return badRequest(c, parsed.error);

  // The cache wraps the provider, so neither the orchestrator nor the provider
  // know it exists.
  const provider = new QuickActionsRenderer(c.env.BROWSER);
  const renderer = cacheable(parsed.data)
    ? new CachedRenderer(c.env, provider, parsed.data.maxAge ?? 0)
    : provider;

  const res = await read(parsed.data, renderer, c.env);
  if (!res.success) {
    // Nothing came back, so there is nothing to pay for. The charge happens before the
    // work —that is what lets the price be known up front— so giving it back is how
    // that promise stays honest.
    await refund(c, "refund: nothing came back");
    // No format came out: the client has nothing to use, so this is not a 200.
    return c.json(res, 502);
  }
  return c.json(res, 200);
});

/**
 * Gives back what this call was charged. Only for the key gate: an x402 payment is
 * settled on-chain and cannot be reversed from here, which is written down in the
 * README rather than pretended away.
 */
async function refund(c: Context<{ Bindings: Env }>, concept: string): Promise<void> {
  const payer = c.get("payer");
  if (!payer?.account?.id || !payer.chargedMicros) return;
  await credit(c.env.BILLING, payer.account.id, payer.chargedMicros, concept).catch((e) =>
    console.error(`refund failed: ${e}`),
  );
  c.header("x-oassis-refunded", inDollars(payer.chargedMicros));
}


for (const route of bothPaths("session")) app.get(route, (c) => cacheableDoc(c, sessionDoc(c)));

/**
 * Calls the Durable Object holding the session. Its response is forwarded as-is,
 * so the price headers the guard set are copied by hand: otherwise the session
 * routes would be the only ones that do not say what they cost.
 */
/**
 * Gives back the actions that never ran.
 *
 * `act` is charged for every action in the request, before any of them runs, because
 * that is what lets the price be quoted up front. But actions stop at the first failure,
 * so a request of twenty whose first one fails did one action's worth of work and was
 * charged for twenty. The response says exactly how many were attempted, so the
 * difference goes back.
 *
 * The attempted one is not refunded even when it failed: the browser did the work of
 * trying. What is refunded is the work nobody did.
 */
async function refundUnrunActions(
  c: Context<{ Bindings: Env }>,
  pedidas: number,
  res: Response,
): Promise<Response> {
  try {
    const copia = res.clone();
    const body = (await copia.json()) as { actions?: unknown[] };
    const corridas = Array.isArray(body.actions) ? body.actions.length : pedidas;
    const sobrantes = pedidas - corridas;
    if (sobrantes > 0) {
      const micros = sobrantes * PRICES.action;
      const payer = c.get("payer");
      if (payer?.account?.id && micros > 0) {
        await credit(c.env.BILLING, payer.account.id, micros, `refund: ${sobrantes} action(s) never ran`).catch(
          (e) => console.error(`partial refund failed: ${e}`),
        );
        c.header("x-oassis-refunded", inDollars(micros));
      }
    }
  } catch {
    // An unreadable answer is not a reason to take money that was not earned, but it is
    // also not enough to know how much: the charge stands and the error is the caller's.
  }
  return res;
}

async function callSession(
  c: Context<{ Bindings: Env }>,
  id: string,
  message: Message,
): Promise<Response> {
  const stub = c.env.SESSIONS.get(c.env.SESSIONS.idFromString(id));
  const response = await stub.fetch("https://session/", {
    method: "POST",
    body: JSON.stringify(message),
    headers: { "content-type": "application/json" },
  });

  const withPrice = new Response(response.body, response);
  for (const header of ["x-oassis-price", "x-oassis-balance"]) {
    const value = c.res.headers.get(header);
    if (value) withPrice.headers.set(header, value);
  }
  return withPrice;
}

app.on("POST", bothPaths("session"), async (c) => {
  const parsed = sessionRequest.safeParse(parsedBody(c));
  if (!parsed.success) return badRequest(c, parsed.error);

  const payer = c.get("payer");
  const id = c.env.SESSIONS.newUniqueId().toString();
  // Recorded before opening: it is what counts towards the concurrency limit and
  // what lets the time be billed when it closes.
  // The identity covers both gates: an account id, or `wallet:0x…` for a wallet payer.
  await registerSession(c.env.BILLING, id, payer?.identity ?? null, payer?.gate ?? "x402");

  let response: Response;
  try {
    response = await callSession(c, id, { kind: "open", req: parsed.data });
  } catch (e) {
    console.error(`session ${id}: ${e instanceof Error ? e.message : String(e)}`);
    response = c.json(
      { success: false, error: "browser_error", message: "The session could not be opened." },
      502,
    );
  }

  if (!response.ok) {
    // The row cannot stay open: it would count towards the limit forever. And
    // what was charged goes back: a session that never opened is not a service.
    await closeSession(c.env.BILLING, id, () => 0).catch(() => null);
    await refund(c, "refund: session did not open");
  }
  return response;
});

/**
 * A `sessionId` is the only handle on a live browser that may hold someone
 * else's cookies and signed-in state, so holding a valid key is not enough: the
 * session has to be yours. A session that is not yours answers exactly like one
 * that does not exist — a 404 — so this endpoint cannot be used to find out which
 * session ids are alive.
 */
async function sessionNotYours(
  c: Context<{ Bindings: Env }>,
  sessionId: string,
  caller: string | null,
): Promise<Response | null> {
  const access = sessionAccess(await sessionOwner(c.env.BILLING, sessionId), caller);
  if (access === "ok") return null;
  return c.json(
    {
      success: false,
      error: "session_not_found",
      message: "That session does not exist, is already closed, or is not yours.",
    },
    404,
  );
}

for (const route of bothPaths("act")) app.get(route, (c) => cacheableDoc(c, actDoc(c)));

app.on("POST", bothPaths("act"), async (c) => {
  const parsed = actRequest.safeParse(parsedBody(c));
  if (!parsed.success) return badRequest(c, parsed.error);

  // Whose session it is was already checked by the billing guard, before charging.
  const { sessionId, actions, ...rest } = parsed.data;

  const req = sessionRequest.safeParse({ ...rest, url: rest.url ?? "https://placeholder.invalid" });
  if (!req.success) return badRequest(c, req.error);

  // The placeholder url goes unused: acting never navigates unless a `navigate`
  // action asks for it.
  const res = await callSession(c, sessionId, { kind: "act", actions, req: req.data });
  return refundUnrunActions(c, actions.length, res);
});

app.on("DELETE", bothPaths("session/:id"), async (c) => {
  /**
   * Closing is free, so the billing guard never runs here and the caller has to be resolved
   * by hand: otherwise anybody holding an id could kill a stranger's session mid-work. A key
   * identifies an account; a wallet identifies itself with the signature it already sends.
   */
  const who = await jobCaller(c);
  if (who instanceof Response) return who;

  const sessionId = c.req.param("id") ?? "";
  const denied = await sessionNotYours(c, sessionId, who);
  if (denied) return denied;

  return callSession(c, sessionId, { kind: "close" });
});


for (const route of bothPaths("scrape/batch")) app.get(route, (c) => cacheableDoc(c, batchDoc(c)));

async function callJob(c: Context<{ Bindings: Env }>, id: string, message: JobMessage): Promise<Response> {
  const stub = c.env.JOBS.get(c.env.JOBS.idFromString(id));
  const response = await stub.fetch("https://job/", {
    method: "POST",
    body: JSON.stringify(message),
    headers: { "content-type": "application/json" },
  });
  const withPrice = new Response(response.body, response);
  for (const header of ["x-oassis-price", "x-oassis-balance"]) {
    const value = c.res.headers.get(header);
    if (value) withPrice.headers.set(header, value);
  }
  return withPrice;
}

app.on("POST", bothPaths("scrape/batch"), async (c) => {
  const parsed = batchRequest.safeParse(parsedBody(c));
  if (!parsed.success) return badRequest(c, parsed.error);

  const payer = c.get("payer");
  const id = c.env.JOBS.newUniqueId().toString();
  // Ownership is recorded before the job starts: collecting it later has to be
  // checkable, and an unowned job would be readable by anyone with the id.
  await registerJob(
    c.env.BILLING,
    id,
    payer?.identity ?? null,
    payer?.gate ?? "x402",
    parsed.data.urls.length,
    payer?.chargedMicros ?? 0,
  );
  return callJob(c, id, {
    kind: "create",
    req: parsed.data,
    account: payer?.account?.id ?? null,
    chargedMicros: payer?.chargedMicros ?? 0,
  });
});

/**
 * Collecting and cancelling are free, so the billing guard never runs here and the
 * key is resolved by hand — a job carries whatever the pages contained, and it is
 * not for anyone who guesses an id.
 */
async function jobCaller(c: Context<{ Bindings: Env }>): Promise<string | null | Response> {
  const key = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (key) {
    const found = await accountForKey(c.env.BILLING, key);
    if (!found) {
      return c.json({ success: false, error: "unauthorized", message: "Invalid or revoked key." }, 401);
    }
    return found.id;
  }
  /**
   * A wallet caller proves who they are the same way they paid: by signing. Collecting is
   * free, so there is no payment to make here — the signature on the header is enough to
   * show the job is theirs, and without it a wallet job would be readable by anyone.
   */
  const wallet = payerFromHeaders(c.req.raw.headers);
  return wallet ? walletIdentity(wallet) : null;
}

for (const route of bothPaths("scrape/batch/:id")) {
  app.get(route, async (c) => {
    const who = await jobCaller(c);
    if (who instanceof Response) return who;
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
    return jobFor(c, c.req.param("id") ?? "", who, { kind: "status", limit });
  });

  app.delete(route, async (c) => {
    const who = await jobCaller(c);
    if (who instanceof Response) return who;
    return jobFor(c, c.req.param("id") ?? "", who, { kind: "cancel" });
  });
}

/**
 * A job that is not yours reads exactly like one that does not exist, same as a
 * session: a 404 that cannot be used to discover which job ids are alive.
 */
async function jobFor(
  c: Context<{ Bindings: Env }>,
  id: string,
  caller: string | null,
  message: JobMessage,
): Promise<Response> {
  const owner = await jobOwner(c.env.BILLING, id);
  if (sessionAccess(owner, caller) !== "ok") {
    return c.json(
      {
        success: false,
        error: "job_not_found",
        message: "That job does not exist or is not yours.",
      },
      404,
    );
  }
  return callJob(c, id, message);
}


for (const route of bothPaths("map")) app.get(route, (c) => cacheableDoc(c, mapDoc(c)));

app.on("POST", bothPaths("map"), async (c) => {
  const parsed = mapRequest.safeParse(parsedBody(c));
  if (!parsed.success) return badRequest(c, parsed.error);

  const started = Date.now();
  const res = await mapSite(parsed.data, async () => {
    // One render, and only when the page is wanted.
    const provider = new QuickActionsRenderer(c.env.BROWSER);
    const page = await scrape(
      { ...parsed.data, formats: ["links"], binaryAs: "base64" } as never,
      provider,
    );
    return Array.isArray(page.data.links) ? (page.data.links as string[]) : [];
  }, servedText(c));

  /**
   * A map that found nothing is work that did not happen.
   *
   * This marked `success: false` and charged anyway, while scrape in the same situation
   * refunds and answers 502. Mapping a domain that does not resolve cost $0.0003 and
   * returned an empty list with a 200 — which is the promise on our own front page
   * broken by the route next door to the one that keeps it.
   */
  if (res.urls.length === 0) {
    await refund(c, "refund: nothing to map");
    return c.json(
      { success: false, urls: [], metadata: { url: parsed.data.url, returned: 0, discovered: 0, ms: Date.now() - started } },
      502,
    );
  }

  return c.json({
    success: res.urls.length > 0,
    urls: res.urls,
    metadata: {
      url: parsed.data.url,
      // What came back, and what there was before the limit cut it: the second is
      // what tells a caller whether to ask for more.
      returned: res.urls.length,
      discovered: res.discovered,
      sources: res.sources,
      sitemaps: res.sitemaps,
      ms: Date.now() - started,
    },
  });
});


for (const route of bothPaths("crawl")) app.get(route, (c) => cacheableDoc(c, crawlDoc(c)));

async function callCrawl(c: Context<{ Bindings: Env }>, id: string, message: CrawlMessage): Promise<Response> {
  const stub = c.env.CRAWLS.get(c.env.CRAWLS.idFromString(id));
  const response = await stub.fetch("https://crawl/", {
    method: "POST",
    body: JSON.stringify(message),
    headers: { "content-type": "application/json" },
  });
  const withPrice = new Response(response.body, response);
  for (const header of ["x-oassis-price", "x-oassis-balance"]) {
    const value = c.res.headers.get(header);
    if (value) withPrice.headers.set(header, value);
  }
  return withPrice;
}

app.on("POST", bothPaths("crawl"), async (c) => {
  const parsed = crawlRequest.safeParse(parsedBody(c));
  if (!parsed.success) return badRequest(c, parsed.error);

  const payer = c.get("payer");
  const id = c.env.CRAWLS.newUniqueId().toString();
  await registerJob(
    c.env.BILLING,
    id,
    payer?.identity ?? null,
    payer?.gate ?? "x402",
    parsed.data.limit,
    payer?.chargedMicros ?? 0,
  );
  return callCrawl(c, id, {
    kind: "create",
    req: parsed.data,
    account: payer?.account?.id ?? null,
    chargedMicros: payer?.chargedMicros ?? 0,
  });
});

for (const route of bothPaths("crawl/:id")) {
  app.get(route, async (c) => {
    const who = await jobCaller(c);
    if (who instanceof Response) return who;
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 50) || 50));
    return crawlFor(c, c.req.param("id") ?? "", who, { kind: "status", limit });
  });

  app.delete(route, async (c) => {
    const who = await jobCaller(c);
    if (who instanceof Response) return who;
    return crawlFor(c, c.req.param("id") ?? "", who, { kind: "cancel" });
  });
}

async function crawlFor(
  c: Context<{ Bindings: Env }>,
  id: string,
  caller: string | null,
  message: CrawlMessage,
): Promise<Response> {
  const owner = await jobOwner(c.env.BILLING, id);
  if (sessionAccess(owner, caller) !== "ok") {
    return c.json(
      { success: false, error: "job_not_found", message: "That crawl does not exist or is not yours." },
      404,
    );
  }
  return callCrawl(c, id, message);
}


for (const route of bothPaths("search/exa")) app.get(route, (c) => cacheableDoc(c, searchDoc(c)));

app.on("POST", bothPaths("search/exa"), async (c) => {
  const parsed = searchRequest.safeParse(parsedBody(c));
  if (!parsed.success) return badRequest(c, parsed.error);

  const started = Date.now();
  try {
    const { results, paidMicros } = await search(c.env, parsed.data);
    if (paidMicros) c.header("x-oassis-paid-upstream", inDollars(paidMicros));
    return c.json({
      /**
       * The search ran, so it worked. A query nothing matches is an answer, not a failure:
       * calling it one while keeping the money — Exa was paid either way — would read like
       * a robbery, and `returned` already says how many came back.
       */
      success: true,
      results,
      metadata: {
        query: parsed.data.query,
        engine: ENGINE,
        returned: results.length,
        ms: Date.now() - started,
      },
    });
  } catch (e) {
    /**
     * We were paid before the work, and the work did not happen. A key gets its balance
     * back here; a wallet was never settled, because the x402 middleware cancels the
     * settlement on any status at or above 400. So nothing was charged either way.
     *
     * The reason stays in the log: these messages name the wallet and how this deployment
     * is configured, which is ours to read and not the caller's.
     */
    await refund(c, "refund: search failed");
    console.error(`search: ${e instanceof Error ? e.message : String(e)}`);
    return c.json(
      {
        success: false,
        error: "search_failed",
        message: "The search could not be completed, so you were not charged.",
      },
      502,
    );
  }
});

/** The bare domain, and www: where a person lands rather than a client. */
const isSite = (c: Context<{ Bindings: Env }>) => {
  const host = new URL(c.req.url).hostname;
  const apex = c.env.BASE_URL ? new URL(c.env.BASE_URL).hostname.split(".").slice(-2).join(".") : "";
  return Boolean(apex) && (host === apex || host === `www.${apex}`);
};

/** The mark, on every host. Free: a crawler fetches it before it reads anything else. */
mountIcon(app);

/** What a person looks for before trusting an API with money, and what a directory demands. */
const htmlPage = (body: string) =>
  new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
app.get("/privacy", (c) => htmlPage(privacyPage(c)));
app.get("/support", (c) => htmlPage(supportPage(c)));
app.get("/terms", (c) => htmlPage(termsPage(c)));

app.get("/robots.txt", (c) =>
  c.text(robotsTxt(c), 200, { "cache-control": "public, max-age=86400", "content-type": "text/plain; charset=utf-8" }),
);
app.get("/sitemap.xml", (c) =>
  c.text(sitemapXml(c), 200, { "cache-control": "public, max-age=86400", "content-type": "application/xml" }),
);

/**
 * The catalogue, for machines. Free and cacheable on both hosts, because an API nobody can
 * discover is an API nobody buys from: this is what a directory indexes and what an agent
 * reads before its first call.
 */
app.get("/openapi.json", (c) => cacheableDoc(c, openapi(c)));
app.get("/llms.txt", (c) =>
  c.text(llmsTxt(c), 200, { "cache-control": "public, max-age=3600", "content-type": "text/plain; charset=utf-8" }),
);

/**
 * Operations, not product: the console and its readings. A stub in this repo, the real file
 * copied in before deploying. Mounted last so it can never shadow a product route.
 */
mountBackoffice(app);

app.notFound((c) =>
  c.json({ success: false, error: "not_found", endpoints: ["POST /web/v1/scrape"] }, 404),
);

app.onError((e, c) => {
  /**
   * An HTTPException already carries the answer it wants to give — a 401 with the
   * authentication header, a 413, a 400 from a parser. Swallowing it into a 500 turned the
   * console's password prompt into "Unexpected error", and would do the same to any other
   * one thrown from a middleware.
   */
  if (e instanceof HTTPException) return e.getResponse();
  console.error(e);
  return c.json({ success: false, error: "internal", message: "Unexpected error." }, 500);
});

export default app satisfies ExportedHandler<Env>;
