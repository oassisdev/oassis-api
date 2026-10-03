/**
 * The wallet gate: pay per call with x402 (USDC on Base).
 *
 * The price is NOT flat: it is computed from the request body, because asking for
 * markdown and asking for eight formats with a PDF do not cost the same. The SDK
 * accepts a price as a function of the request and the Hono adapter knows how to
 * read the body, so the 402 challenge announces the exact amount for that call.
 *
 * About the facilitator, which is where this breaks: the public one at x402.org
 * **does not settle on Base mainnet**, only on the test network. Charging for
 * real needs Coinbase (CDP) keys. Without them the gate stays on the test
 * network, and says so out loud in the log instead of pretending to charge.
 */

import { createFacilitatorConfig } from "@coinbase/x402";
// The SERVER scheme lives in its own subpath: the one at the package root is the
// client scheme and does not implement what the resource server needs.
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/hono";
import type { MiddlewareHandler } from "hono";
import { BAZAAR } from "./bazaar";
import { actDoc, batchDoc, crawlDoc, doc, mapDoc, searchDoc, sessionDoc } from "../docs";
import { priceOfRequest, inDollars } from "./prices";
import { priceOfSearch } from "../search/exa";
import { searchRequest } from "../schema";
import type { Env } from "../types";

type Route = "scrape" | "session" | "act" | "batch" | "map" | "crawl" | "search";

/**
 * The url segment each route answers on. It is not always the route's name — the batch
 * lives under `scrape/` and the search names its engine — and getting this wrong is silent:
 * a route missing from the table is simply not paywalled, and the handler runs for free.
 */
const SEGMENT: Record<Route, string> = {
  scrape: "scrape",
  session: "session",
  act: "act",
  batch: "scrape/batch",
  map: "map",
  crawl: "crawl",
  search: "search/exa",
};

/** What a search costs is Exa's to say, read from its own challenge on every call. */
const SEARCH_FALLBACK = 7_000;

/** The smallest call each route accepts, used to quote a request that carries no body. */
const SMALLEST_CALL: Record<Route, Record<string, unknown>> = {
  scrape: { formats: ["markdown"] },
  session: {},
  act: { actions: [{ press: "Enter" }] },
  batch: { urls: ["https://oassis.dev", "https://oassis.dev/privacy"] },
  map: { includePage: false },
  crawl: { limit: 1 },
  search: { query: "", limit: 10 },
};

const BASE = "eip155:8453";
const BASE_TESTNET = "eip155:84532";

/**
 * Price of the call, read from its body. If the body cannot be read, the route's
 * minimum is charged: better to undercharge than to invent an amount the client
 * had no way to predict.
 */
function priceFor(route: Route) {
  return async (ctx: { adapter: { getBody?: () => unknown } }) => {
    let body: Record<string, unknown> = {};
    try {
      const read = await ctx.adapter.getBody?.();
      if (read && typeof read === "object") body = read as Record<string, unknown>;
    } catch {
      /* no body: the minimum */
    }
    /**
     * Nothing readable in the body means this is a discovery probe, and what it needs is a
     * price that means something. Pricing an empty batch quoted $0 — a shop window saying
     * the goods are free — so an empty body is quoted as the smallest real call instead.
     */
    if (Object.keys(body).length === 0) body = SMALLEST_CALL[route];

    if (route === "search") {
      // Asking Exa costs nothing, and its answer is the only honest price for this call.
      try {
        const wanted = searchRequest.safeParse(body);
        return inDollars(await priceOfSearch(wanted.success ? wanted.data : ({ query: "", limit: 10 } as never)));
      } catch {
        return inDollars(SEARCH_FALLBACK);
      }
    }
    return inDollars(priceOfRequest(route, body as never));
  };
}

/** Built once per isolate: assembling it per request costs hundreds of ms. */
let cache: { mw: MiddlewareHandler<{ Bindings: Env }> } | { error: string } | undefined;

export function x402(env: Env): MiddlewareHandler<{ Bindings: Env }> | null {
  if (cache) return "mw" in cache ? cache.mw : null;

  const payTo = env.X402_PAY_TO;
  if (!payTo) {
    cache = { error: "no X402_PAY_TO" };
    return null;
  }

  const withCdp = Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET);
  const wantsMainnet = (env.X402_NETWORK ?? "base") === "base";
  if (wantsMainnet && !withCdp) {
    console.warn(
      "x402: Base mainnet was requested without CDP keys. The public facilitator does not settle there, so the wallet gate stays on the test network.",
    );
  }
  const network = (wantsMainnet && withCdp ? BASE : BASE_TESTNET) as `${string}:${string}`;

  try {
    const facilitator = new HTTPFacilitatorClient(
      withCdp && wantsMainnet
        ? createFacilitatorConfig(env.CDP_API_KEY_ID as string, env.CDP_API_KEY_SECRET as string)
        : { url: env.X402_FACILITATOR_URL || "https://x402.org/facilitator" },
    );
    const server = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());

    const common = (route: Route) => ({
      accepts: { scheme: "exact" as const, price: priceFor(route), network, payTo: payTo as `0x${string}` },
      /**
       * The challenge travels in the `PAYMENT-REQUIRED` header, which is where a
       * wallet looks for it. The body, empty by default, is filled in so a person
       * (or an agent without x402 support) can understand the 402 without having
       * to decode base64.
       */
      unpaidResponseBody: async (ctx: { adapter: { getBody?: () => unknown } }) => ({
        contentType: "application/json",
        body: {
          success: false,
          error: "payment_required",
          message: "Pay with a wallet (x402, USDC) or use an API key: `Authorization: Bearer oas_…`.",
          price: await priceFor(route)(ctx),
          docs: "/web/v1/scrape",
        },
      }),
    });

    /** The self-describing document each route answers with, now inside its 402. */
    const DOC_FOR: Record<Route, (c: never) => unknown> = {
      scrape: doc,
      session: sessionDoc,
      act: actDoc,
      batch: batchDoc,
      map: mapDoc,
      crawl: crawlDoc,
      search: searchDoc,
    };

    const DESCRIPTIONS: Record<Route, string> = {
      scrape: "Web extraction: every output you ask for in `formats`, in one call.",
      session: "Opens a browser session and returns the map of controls.",
      act: "Runs actions against an open session and returns the resulting state.",
      batch: "Reads a list of urls you give it and returns a job to collect.",
      map: "Lists a site's urls, from its sitemap and its page.",
      crawl: "Follows a site's links and reads every page, as a job.",
      search: "Web search through Exa's index, at Exa's own price.",
    };

    // Every route in both shapes: `/web/v1/x` on the umbrella (api.oassis.dev)
    // and `/v1/x` on the family host (web.oassis.dev). Both have to be in the
    // table or the 402 challenge would not be issued on one of them.
    const routes: Parameters<typeof paymentMiddleware>[0] = {};
    for (const route of Object.keys(SEGMENT) as Route[]) {
      for (const path of [`/web/v1/${SEGMENT[route]}`, `/v1/${SEGMENT[route]}`]) {
        const cfg = {
          ...common(route),
          description: DESCRIPTIONS[route],
          // What makes the endpoint discoverable in Coinbase's registry, and through it
          // in the rest of the x402 layer. See bazaar.ts for why the examples are
          // written by hand.
          extensions: { bazaar: BAZAAR[route] },
        };
        routes[`POST ${path}`] = cfg;

        /**
         * The GET is gated too, and this is the part that actually gets us indexed.
         *
         * Coinbase's validator probes a resource with GET. Ours answered 200 with the
         * self-describing document, so its `returns_402` check discarded the resource
         * before ever reading the extension — asked on 2026-10-03 it came back
         * `bazaarExtension: null, index: null`, having read our documentation instead of
         * our challenge. AgisHub saw 0 of ~14,669 probes get in for the same reason.
         *
         * What the open GET was for — that a crawler or a person reads the document
         * rather than a bare 402 — is kept by serving **the document as the body of the
         * 402**. Same bytes, same fields, same price: only the status changes, from 200
         * to 402, which is what the validator needs to see.
         */
        routes[`GET ${path}`] = {
          ...cfg,
          unpaidResponseBody: () => ({
            contentType: "application/json",
            // The documents need nothing from the request but its path, which decides
            // the prefix: `/web/v1` on the umbrella host, `/v1` on the family one.
            body: DOC_FOR[route]({ req: { path } } as never) as unknown as Record<string, unknown>,
          }),
        };
      }
    }

    const mw = paymentMiddleware(routes, server) as unknown as MiddlewareHandler<{ Bindings: Env }>;

    cache = { mw };
    return mw;
  } catch (e) {
    // The wallet gate failing to assemble must not take the request down: the
    // guard will answer that a key is needed.
    const error = e instanceof Error ? e.message : String(e);
    console.error(`x402: wallet gate unavailable: ${error}`);
    cache = { error };
    return null;
  }
}
