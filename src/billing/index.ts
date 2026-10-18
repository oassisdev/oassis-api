/**
 * The guard on the two gates.
 *
 * - **API key** (`Authorization: Bearer oas_…`): debited from the account's
 *   balance. Pays exactly what it consumes and can hold long sessions, because
 *   browser time is billed when they close.
 * - **x402 wallet**: pay per call, no account. There is nobody to bill later, so
 *   a session opened that way lives as long as its idle window and every action
 *   is paid for in its own call.
 *
 * Whoever brings neither gets a 402 carrying the exact price of that call, which
 * is how an agent learns what it has to pay.
 */

import { prepaidIdentity } from "../site-payments";
import { ensureBilling } from "./stripe";
import type { Context, MiddlewareHandler } from "hono";
import {
  recordWalletPayment,
  requestAccount,
  sessionAccess,
  sessionOwner,
  type Account,
} from "./accounts";
import { CREDIT_GUIDE, creditsFor } from "./credits";
import { inDollars, priceOfRequest } from "./prices";
import { cacheable } from "../cache";
import { cachedFormats } from "../cached-renderer";
import { renderPlan } from "../scrape";
import {
  actRequest,
  batchRequest,
  crawlRequest,
  mapRequest,
  scrapeRequest,
  searchRequest,
  sessionRequest,
} from "../schema";
import { priceOfSearch, searchAvailable } from "../search/exa";
import { payerFromHeaders, walletIdentity } from "./payer";
import { badRequest } from "../http";
import { x402 } from "./x402";
import type { Env, Format } from "../types";

export type Gate = "key" | "x402";

/** What the rest of the code needs to know about the caller. */
export interface Payer {
  gate: Gate;
  account?: Account;
  /** The address that signed the payment, when this was a wallet call. */
  wallet?: string;
  chargedMicros: number;
  /**
   * Who this caller is, for anything that has an owner: an account id, or `wallet:0x…`.
   * Null only when a wallet paid and its address could not be read.
   */
  identity: string | null;
}

declare module "hono" {
  interface ContextVariableMap {
    payer: Payer;
    body: Record<string, unknown>;
  }
}

/**
 * Definitive paid routes. Web Tools and extraction Tasks share the billing guard.
 */
const ROUTES: Record<string, "scrape" | "session" | "act" | "batch" | "map" | "crawl" | "search"> = {
 "/web/v1/scrape":"scrape", "/web/v1/session":"session", "/web/v1/act":"act",
 "/web/v1/map":"map", "/web/v1/search":"search",
 "/tasks/v1/scrape/batch":"batch", "/tasks/v1/crawl":"crawl",
};

/** The schema of each route, so an invalid request is refused before it is charged. */
const SHAPES = {
  scrape: scrapeRequest,
  session: sessionRequest,
  act: actRequest,
  batch: batchRequest,
  map: mapRequest,
  crawl: crawlRequest,
  search: searchRequest,
} as const;

/**
 * Billing middleware. It only acts on the product routes; everything else (the
 * front page, the self-describing docs, closing a session) passes through free.
 */
export const billing: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const route = ROUTES[new URL(c.req.url).pathname];
  if (!route) return next();

  /**
   * A GET on a product route is the self-describing document, and it now answers 402
   * with that document as its body.
   *
   * Coinbase's validator probes with GET, and a 200 made it discard the resource before
   * reading the challenge — it replied `bazaarExtension: null` while quoting our
   * documentation back at us. The document is unchanged and still free; what changed is
   * the status beside it, which is the one thing that validator looks at.
   *
   * Only the bare route paths are in ROUTES, so polling a job — `/scrape/batch/:id`,
   * `/crawl/:id` — is untouched and stays free.
   */
  if (c.req.method === "GET") {
    const gate = x402(c.env);
    return gate ? await gate(c, async () => undefined) : next();
  }
  if (c.req.method !== "POST") return next();
  const prepaid = c.req.header("x-oassis-payment") === "balance";
  const keyAccount = await requestAccount(c.env.BILLING,c.req.raw.headers);
  if(keyAccount === "invalid") return c.json({success:false,error:"invalid_api_key"},401);
  const prepaidAccount = keyAccount?.id ?? (prepaid ? await prepaidIdentity(c.env,c.req.raw) : null);
  if(prepaid && !prepaidAccount)return c.json({success:false,error:"verified_website_session_required"},401);

  // The body is read once here and kept: reading it again in the handler would
  // hand back an already-consumed stream.
  let body: Record<string, unknown> = {};
  let readable = true;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    readable = false;
  }
  c.set("body", body);

  /** Validated before charging: nothing invalid ever reaches a charge. */
  const shape = SHAPES[route].safeParse(body);

  if (!readable || !shape.success) {
    /**
     * A bare request is how the paywall is discovered. Every x402 crawler, directory and
     * registry probes a route with nothing in it to see what it costs; answering "your body
     * is invalid" told them there was nothing for sale here, and only a caller who already
     * knew the exact request shape could ever learn the price.
     *
     * So an unpaid stranger gets the 402 with this route's minimum instead of a complaint:
     * a challenge is a quote, not a charge, and nothing is taken by issuing one. Anyone who
     * did send a key or a payment gets the precise error they need — and a payment attached
     * to an invalid body is never settled, because the middleware cancels settlement on any
     * status at or above 400.
     */
    const identified =
      prepaid || Boolean(keyAccount) || Boolean(c.req.header("x-payment")) ||
      Boolean(c.req.header("payment-signature"));
    const gate = identified ? null : x402(c.env);
    if (gate) return await gate(c, async () => undefined);

    if (!shape.success) return badRequest(c, shape.error);
    return c.json({ success: false, error: "bad_request", message: "The body must be JSON." }, 400);
  }

  // The price carries the cache discount from the start: the cache is looked up
  // here, before charging, so the 402 challenge and the charge both already say
  // what this call really costs. Discovering the hits after the fact would mean
  // charging full price and refunding, which no agent can plan around.
  /**
   * A route the deployment cannot serve is refused before it is priced. Checking this in
   * the handler meant a search was charged and then answered 503 "no wallet": money for a
   * call that could never have run.
   */
  if (route === "search" && !searchAvailable(c.env)) {
    return c.json(
      {
        success: false,
        error: "search_unavailable",
        message: "Search is not configured on this deployment: there is no wallet to pay the provider with.",
      },
      503,
    );
  }

  /**
   * Search is the one route whose price is not ours: it is whatever Exa charges, read
   * from its own payment challenge before anybody is charged. Asking is free, so this
   * costs a round trip and buys the only honest version of "passed through at cost".
   */
  let micros: number;
  if (route === "search") {
    const wanted = searchRequest.safeParse(body);
    try {
      micros = await priceOfSearch(wanted.success ? wanted.data : ({ query: "", limit: 10 } as never));
    } catch (e) {
      console.error(`search price: ${e instanceof Error ? e.message : String(e)}`);
      return c.json(
        {
          success: false,
          error: "search_unavailable",
          message: "Could not read the search provider's price, so nothing was charged. Try again shortly.",
        },
        503,
      );
    }
  } else {
    micros = priceOfRequest(route, body as never, await cacheHits(c, route, body));
  }
  if (route === "act") {
    const sessionId=typeof body.sessionId==='string'?body.sessionId:'';
    const wallet=payerFromHeaders(c.req.raw.headers);
    const access=sessionAccess(await sessionOwner(c.env.BILLING,sessionId),prepaidAccount||(wallet?walletIdentity(wallet):null));
    if(access!=='ok')return c.json({success:false,error:'session_not_found'},404);
  }
  if(prepaidAccount){
    const row=prepaidAccount.startsWith("site:") ? await ensureBilling(c.env,prepaidAccount.slice(5)) : {balance_micros:keyAccount ? keyAccount.balanceMicros : 0};
    try {await c.env.BILLING.prepare('INSERT INTO prepaid_debits(id,account,micros,at,route) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),prepaidAccount,micros,Date.now(),new URL(c.req.url).pathname).run();}
    catch(e){if(String(e).includes('insufficient_balance'))return c.json({success:false,error:'insufficient_credits',required_credits:creditsFor(micros),available_credits:creditsFor(row.balance_micros),message:CREDIT_GUIDE,recharge_url:'https://oassis.dev/dashboard/billing'},402);throw e;}
    c.set('payer',{gate:'key',account:{id:prepaidAccount,balanceMicros:row.balance_micros-micros,maxSessions:3},identity:prepaidAccount,chargedMicros:micros});
    c.header('x-oassis-credits',String(creditsFor(micros)));
    c.header('x-oassis-price',inDollars(micros));
    c.header('x-oassis-balance',inDollars(row.balance_micros-micros));
    await next();return;
  }
  // No key: the wallet gate. The x402 middleware answers the 402 with the exact
  // amount, verifies the payment and only then lets the call through.
  const walletGate = x402(c.env);
  if (!walletGate) {
    return c.json(
      {
        success: false,
        error: "payment_required",
        message:
          "Wallet payment is not configured on this deployment. No API key is required.",
        price: inDollars(micros),
      },
      402,
    );
  }

  /**
   * Whether the payment was verified: the handler below only runs once it is, so this is
   * how we tell "the caller has not paid yet" from "the gate itself could not answer".
   */
  let verified = false;

  try {
    const answer = await walletGate(c, async () => {
      verified = true;
      /**
       * The payment has been verified by the time this runs, so the address that signed it
       * is the caller's identity — without it, two wallet callers are indistinguishable and
       * can reach each other's sessions.
       */
      const wallet = payerFromHeaders(c.req.raw.headers);
      const identity = wallet ? walletIdentity(wallet) : null;
      c.set("payer", { gate: "x402", wallet: wallet ?? undefined, chargedMicros: micros, identity });

      // Recorded so a wallet caller has a history too, under the same account column.
      if (identity) {
        await recordWalletPayment(c.env.BILLING, identity, micros, new URL(c.req.url).pathname).catch(
          () => undefined,
        );
      }

      c.header("x-oassis-price", inDollars(micros));
      await next();
    });

    /**
     * The middleware answers the 402 challenge itself, which is the normal case. What it
     * also does, and what this is for, is **return** its own 500 when it cannot reach its
     * facilitator — an expired key, a revoked one, an outage at Coinbase. It does not throw,
     * so the catch below never sees it, and a keyless caller got `Internal Server Error` on
     * the main endpoint of the API. That is our problem and it has an answer: use a key.
     */
    const status = answer?.status ?? c.res?.status ?? 200;
    if (!verified && status >= 500) {
      console.error(`x402: the wallet gate answered ${status} before any payment: check the facilitator keys`);
      return c.json(
        {
          success: false,
          error: "payment_required",
          message: "Wallet payment is unavailable right now. Try again later; no API key is required.",
          price: inDollars(micros),
        },
        402,
      );
    }
    return answer;
  } catch (e) {
    // The SDK validates its configuration on the first request, and that is
    // where it can discover, say, that the facilitator does not settle on this
    // network. That is our problem, not the client's: ask for a key and log it.
    console.error(`x402: ${e instanceof Error ? e.message : String(e)}`);
    return c.json(
      {
        success: false,
        error: "payment_required",
        message: "Wallet payment is unavailable right now. Try again later; no API key is required.",
        price: inDollars(micros),
      },
      402,
    );
  }
};

/**
 * Formats this call would get from the cache. Only /scrape can: a session is a live
 * browser, and serving a stored page there would be answering about a page that is
 * not the one open.
 */
async function cacheHits(
  c: Context<{ Bindings: Env }>,
  route: string,
  body: Record<string, unknown>,
): Promise<Format[]> {
  if (route !== "scrape" || !c.env.CACHE) return [];
  const parsed = scrapeRequest.safeParse(body);
  if (!parsed.success || !cacheable(parsed.data)) return [];
  const hits = await cachedFormats(c.env, renderPlan(parsed.data), parsed.data.maxAge ?? 0).catch(
    () => [] as string[],
  );
  return hits as Format[];
}

/** The body the guard already read, so the request is not consumed twice. */
export function parsedBody(c: Context<{ Bindings: Env }>): Record<string, unknown> {
  return c.get("body") ?? {};
}
