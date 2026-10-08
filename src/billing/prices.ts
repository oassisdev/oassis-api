/**
 * Prices, in one place.
 *
 * Everything is counted in **micro-dollars** (millionths), which is exactly the
 * smallest unit of USDC: the balance, the recorded movement and the on-chain charge
 * are the same integer, so there is no rounding left to explain a mismatch.
 */

import type { Format } from "../types";
import { documentTypeFromUrl } from "../documents";
import type { ScrapeRequest } from "../schema";

/**
 * What each output costs the caller.
 *
 * One number per output, because that is what a caller can plan around: four formats is
 * four times one format, and the response says how many renders it took. A cache hit and a
 * document need no browser, and are priced apart for that reason rather than as a discount.
 *
 * The prices are set against what the same work costs elsewhere per call, so that a
 * comparison does not rule this out before anybody reads what it does — and there is no
 * monthly fee and no balance that expires.
 */
export const PER_FORMAT: Record<Format, number> = {
  html: 1_000,
  markdown: 1_000,
  links: 1_000,
  elements: 1_000,
  controls: 1_000,
  accessibility: 1_000,
  screenshot: 1_000,
  // A PDF is a heavier render and a much bigger response.
  pdf: 2_000,
  // Carries a model call, which is the expensive part.
  json: 5_000,
};

export const PRICES = {
  /** A cache hit: no browser, no model. Only the lookup and the bytes back. */
  cacheHit: 200,
  /**
   * Reading a document by url (PDF, Word, Excel, CSV). No browser is used, but the
   * bytes are fetched and converted, and a big PDF is real work.
   */
  document: 2_000,
  /** Opening a session: includes the first minute of browser time. */
  sessionOpen: 5_000,
  /** Every action run against a session. */
  action: 500,
  /**
   * Every minute a session stays open past the first, rounded up. Charging by time rather
   * than by call is what makes an idle session cost something: a browser left open is a
   * browser nobody else can use, and the session closes itself after a minute without use.
   */
  sessionMinute: 4_000,
} as const;

/**
 * Cost of a /web/v1/scrape call: the sum of the requested outputs. Formats listed
 * in `cached` are priced as cache hits, because nothing gets rendered for them.
 */
/** Cost of reading a document by url. One price, whatever formats were asked for. */
export function documentPrice(): number {
  return PRICES.document;
}

export function scrapePrice(formats: Format[], cached: Format[] = []): number {
  const hits = new Set(cached);
  return [...new Set(formats)].reduce(
    (total, f) => total + (hits.has(f) ? PRICES.cacheHit : PER_FORMAT[f] ?? 1_000),
    0,
  );
}

/** Cost of opening a session: the opening plus whatever is read while opening. */
export function openPrice(formats: Format[]): number {
  return PRICES.sessionOpen + scrapePrice(formats);
}

/**
 * Cost of acting: the actions plus the outputs read afterwards. Browser time is
 * billed separately, when the session closes.
 */
export function actPrice(actions: number, formats: Format[]): number {
  return actions * PRICES.action + scrapePrice(formats);
}

/** Minutes started between two instants, not counting the first (it is in the opening). */
export function timePrice(openedAt: number, closedAt: number): number {
  const minutes = Math.ceil(Math.max(0, closedAt - openedAt) / 60_000);
  return Math.max(0, minutes - 1) * PRICES.sessionMinute;
}

/**
 * For showing a price to a person: 24_000 → "$0.024". A negative amount keeps the
 * sign outside the currency, "-$0.024", because "$-0.024" reads like a typo.
 */
export function inDollars(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const amount = (Math.abs(micros) / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `${sign}$${amount}`;
}

/**
 * The least a call can cost.
 *
 * The facilitator that settles the wallet gate refuses an amount below this, and it
 * refuses it *after* the caller has signed, with a bare 402 and no reason given — so a
 * route priced under it is not cheap, it is unbuyable, and the caller cannot tell why.
 * Any price the gate can quote has to clear this, which is why it is a floor on the
 * prices themselves and not a surcharge added at the gate: both doors charge the same.
 */
export const MIN_CHARGE = 1_000;

/**
 * Price of a map. A sitemap is plain HTTP with no browser involved, so this is one
 * render when the page is included, and the floor when it is not.
 */
export function mapPrice(includePage: boolean): number {
  return includePage ? 1_500 : MIN_CHARGE;
}

/**
 * Cost of a page inside a crawl: what was asked for, plus the links. A crawl has to
 * read the links to know where to go next, so they are part of the page and come
 * back in the result rather than being charged quietly.
 */
export function crawlPagePrice(formats: Format[]): number {
  return scrapePrice([...new Set<Format>([...formats, "links"])]);
}

/** Cost of a crawl: every page it is allowed to read, charged up front. */
export function crawlPrice(limit: number, formats: Format[]): number {
  return limit * crawlPagePrice(formats);
}

/** Cost of a batch: one scrape per url, charged up front. */
export function batchPrice(urls: number, formats: Format[]): number {
  return urls * scrapePrice(formats);
}

/** Everything about a request's cost that depends on its body, in one place. */
export function priceOfRequest(
  route: "scrape" | "session" | "act" | "batch" | "map" | "crawl",
  body: Partial<ScrapeRequest> & { actions?: unknown[]; urls?: unknown[]; limit?: number },
  cached: Format[] = [],
): number {
  const formats = (body.formats as Format[] | undefined) ?? (route === "session" ? ["controls"] : ["markdown"]);
  if (route === "map") {
    return mapPrice((body as { includePage?: boolean }).includePage !== false);
  }
  if (route === "crawl") {
    const limit = Number((body as { limit?: number }).limit ?? 25) || 25;
    return crawlPrice(limit, formats);
  }
  if (route === "batch") {
    const urls = Array.isArray((body as { urls?: unknown[] }).urls) ? (body as { urls: unknown[] }).urls.length : 0;
    return batchPrice(urls, formats);
  }
  if (route === "scrape") {
    // A url whose extension says PDF, Word or Excel is a document: no browser, one
    // price, and the caller knows it before the call.
    if (typeof body.url === "string" && documentTypeFromUrl(body.url)) return documentPrice();
    return scrapePrice(formats, cached);
  }
  if (route === "session") return openPrice(formats);
  return actPrice(Array.isArray(body.actions) ? body.actions.length : 0, formats);
}
