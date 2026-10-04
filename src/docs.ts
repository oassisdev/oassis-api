/**
 * What each endpoint says about itself.
 *
 * Every route answers its own GET with one of these, free and cacheable, so an agent that
 * finds a url can learn what to post to it without a manual. They live apart from the
 * handlers because they are also the source the OpenAPI document is built from: written
 * twice they would disagree within a week.
 */

import type { Context } from "hono";
import { prefix } from "./http";
import { PRICES, inDollars } from "./billing/prices";
import { ENGINE } from "./search/exa";
import { FORMATS, type Env } from "./types";

export const doc = (c: Context<{ Bindings: Env }>) => ({
  endpoint: `POST ${prefix(c)}/scrape`,
  description:
    "Processes a page and returns every output you ask for in `formats` at once. A partial failure does not void the rest.",
  request: {
    url: "string — page to process (or `html`)",
    html: "string — raw HTML instead of `url`",
    formats: `array — ${FORMATS.join(", ")} (defaults to ["markdown"])`,
    selectors: "array of string — required with the `elements` format",
    json: "{ prompt, schema } — required with the `json` format",
    screenshot: "{ fullPage, type, quality, omitBackground, selector, viewport }",
    pdf: "{ format, landscape, printBackground, scale }",
    links: "{ visibleOnly, excludeExternal }",
    controls: "{ visibleOnly, limit } — options for the `controls` format",
    wait: "{ until, selector, timeout }",
    request: "{ headers, cookies, userAgent, auth }",
    block: "{ resourceTypes, urlPatterns } — urlPatterns are regular expressions, not globs: `\\\\.svg$`, not `*.svg`",
    documents: "a url pointing at a PDF, Word, Excel, CSV or OpenDocument file is converted to markdown without a browser. Only `markdown` comes out of a document",
    maxAge: "number — accept an answer up to this many ms old. A cache hit costs $0.0002 instead of the format price, and the price already says so",
    binaryAs: 'base64 (the only value for now; "url" arrives with storage)',
    viewport: "{ width, height, deviceScaleFactor }",
  },
  response: {
    success: "true when at least one format came out",
    data: "one key per requested format that succeeded",
    errors: "one key per format that failed, with the reason",
    metadata: "url, formats, renders, browserMsUsed, ms, title",
  },
  notes: [
    "Today every format consumes a browser render: 4 formats = 4 renders. `metadata.renders` and `metadata.browserMsUsed` say so in every response.",
    "The PDF and the screenshot arrive base64-encoded inside the JSON.",
    "`controls` returns what can be acted on (role, name, selector, box on screen) in a single render: it is the map an agent needs to decide where to click.",
    "Send `maxAge` to reuse a recent render: `metadata.cached` lists which formats came from the cache, and those are priced at $0.0002. Requests carrying cookies, auth or custom headers are never cached, because the cache is shared.",
  ],
  example: {
    url: "https://oassis.dev",
    formats: ["markdown", "links", "pdf", "json"],
    json: { prompt: "Product name, price and availability" },
    pdf: { format: "a4" },
    wait: { until: "networkidle0" },
  },
});

/**
 * Browser session. Unlike /scrape, the page stays open here: the `ref`s from
 * `controls` still hold on the next call, and you can click and type against the
 * same state. It is billed by time open, so the session closes itself after a
 * minute without use.
 */
/** What can be done to an open page. Named once: /session and /act both list it. */
const ACTIONS = [
  '{ "navigate": "https://…" }',
  '{ "click": { "ref": "button#0" } }',
  '{ "type": { "ref": "input#0", "text": "hello", "clear": true } }',
  '{ "select": { "ref": "select#0", "value": "es" } }',
  '{ "press": "Enter" }',
  '{ "scroll": { "to": "bottom" } }',
  '{ "wait": { "selector": ".results" } }',
  '{ "back": true }',
];

export const sessionDoc = (c: Context<{ Bindings: Env }>) => ({
  endpoints: {
    [`POST ${prefix(c)}/session`]:
      'Opens a session and navigates. Same fields as /scrape; `formats` defaults to ["controls"]. Returns `sessionId`.',
    [`POST ${prefix(c)}/act`]: "Runs `actions` against a session and returns the outputs of the resulting state.",
    [`DELETE ${prefix(c)}/session/:id`]: "Closes the session and stops billing.",
  },
  actions: ACTIONS,
  prices: {
    open: inDollars(PRICES.sessionOpen),
    action: inDollars(PRICES.action),
    minute: `${inDollars(PRICES.sessionMinute)} per minute open past the first`,
  },
  notes: [
    "Actions run in order and stop at the first failure; `actions` in the response says what ran and where it stopped.",
    "A `ref` stops being valid if the DOM changes order: the error says so, and asking for `controls` again is enough.",
    "The session closes after 60 s without use. Close it yourself if you finish earlier.",
  ],
});

/**
 * Batches. A job answers with a `jobId` instead of the work: fifty pages do not fit
 * in one request, and nobody should hold a connection open for minutes.
 */
export const batchDoc = (c: Context<{ Bindings: Env }>) => ({
  endpoints: {
    [`POST ${prefix(c)}/scrape/batch`]:
      "A batch of scrapes: queues one scrape per url you give it. Same fields as /scrape but with `urls` (2–50) and no `url`. Returns a `jobId`. It discovers nothing — for that, use /crawl.",
    [`GET ${prefix(c)}/scrape/batch/:id`]: "Collects the job: status, how many are done, and the results so far. `?limit=1..50`.",
    [`DELETE ${prefix(c)}/scrape/batch/:id`]: "Cancels the job. The urls that never ran are refunded.",
  },
  notes: [
    "Charged up front, one scrape per url. A url that fails outright and a url served from the cache are refunded together when the job ends, as a single movement in your account.",
    "It works in chunks of 3 urls, so a failure costs that chunk and not the whole job.",
    "No `screenshot` or `pdf` in a batch: every result is kept until you collect it. Ask for those one url at a time.",
  ],
});

/**
 * `map`: the urls of a site. Cheap on purpose — the sitemap is plain HTTP and costs
 * no browser — and it is the door into crawling: you map to see what is there before
 * paying to read it.
 */
export const mapDoc = (c: Context<{ Bindings: Env }>) => ({
  endpoint: `POST ${prefix(c)}/map`,
  description: "Every url of a site: its sitemap, plus the links on the page itself.",
  request: {
    url: "string — the site to map",
    limit: "number — urls to return (default 1000, max 5000)",
    includePage: "boolean — render the page too, to catch what the sitemap misses (default true)",
    search: "string — keep only urls containing this text",
    includeSubdomains: "boolean — default false",
    includePaths: "array of string — keep only paths containing one of these",
    excludePaths: "array of string — drop paths containing one of these",
  },
  prices: {
    withPage: inDollars(1_500),
    sitemapOnly: `${inDollars(300)} with \`includePage: false\` — no browser is used`,
  },
});

/**
 * `crawl`: follow the links and read the pages. A crawl is a batch that feeds itself,
 * so it answers with a `jobId` and is collected the same way.
 */
export const crawlDoc = (c: Context<{ Bindings: Env }>) => ({
  endpoints: {
    [`POST ${prefix(c)}/crawl`]:
      "Starts a crawl from `url`. Same fields as /scrape plus `limit` (pages, default 25, max 200), `maxDepth` (default 2) and the site filters. Returns a `jobId`.",
    [`GET ${prefix(c)}/crawl/:id`]: "Collects it: status, pages read, discovered, still queued, and the pages. `?limit=1..50`.",
    [`DELETE ${prefix(c)}/crawl/:id`]: "Cancels it. The pages never read are refunded.",
  },
  notes: [
    "Charged up front for the pages it is allowed to read. A crawl that finds twelve pages when it was allowed thirty refunds the eighteen it never touched, in one movement.",
    "It always reads the links —without them there is nowhere to go next— so they are part of the per-page price and come back in every page.",
    "No `screenshot` or `pdf`: every page is kept until you collect it.",
    "Two pages per alarm, so a failure costs that pair and not the whole crawl.",
  ],
});

/**
 * `search/exa`: a query instead of a url.
 *
 * The engine is in the path on purpose. We are a middleman here —we have no index— and
 * the price is whatever Exa charges, read from its own payment challenge. Hiding which
 * index answered would make that impossible to check, and the day we add another engine
 * it gets its own path rather than silently changing what you bought.
 */
export const searchDoc = (c: Context<{ Bindings: Env }>) => ({
  endpoint: `POST ${prefix(c)}/search/exa`,
  description:
    "Search the web with Exa's index. A query instead of a url, for when you do not know where to look.",
  engine: ENGINE,
  request: {
    query: "string — what to search for",
    limit: "number — results (default 10, max 50)",
    snippets: "boolean — text alongside each result (default true)",
    domains: "array of string — only these domains, subdomains included: `example.com` also matches `docs.example.com`",
    excludeDomains: "array of string — never these domains, subdomains included",
    since: "string — only results published after this ISO date",
  },
  pricing:
    "Exa's price, passed through with no markup, read from its own payment challenge on every call — today $0.007 per search. It can change without us deploying, which is the point.",
  notes: [
    "Results come back as title, url and snippet. To read them, pass the urls to /scrape/batch: searching and reading are separate prices because they are separate work.",
    "A search that matches nothing is still a search: Exa is paid for it, so it is charged. What is refunded is a search that could not be run at all.",
    "We pay Exa over x402 in USDC on Base, the same way you pay us. No account or API key exists anywhere in this chain.",
  ],
});

/**
 * Acting on an open session. It had no document of its own, so a GET answered 404 and the
 * catalogue published six of the seven paid routes — leaving out the one that makes a
 * session worth opening.
 */
export const actDoc = (c: Context<{ Bindings: Env }>) => ({
  endpoint: `POST ${prefix(c)}/act`,
  description:
    "Runs actions against an open session and returns the outputs of the resulting state. The `ref`s from `controls` are what you act on.",
  request: {
    sessionId: "string — the session to act on, from POST /session",
    actions: "array — what to do, in order. One to 25 of the forms listed in `actions`",
    formats: "array — what to return of the resulting state (defaults to the session's)",
  },
  response: {
    success: "true when every action ran",
    actions: "what ran and where it stopped",
    data: "one key per requested format of the state after acting",
  },
  actions: ACTIONS,
  price: `${inDollars(PRICES.action)} per action, plus ${inDollars(PRICES.sessionMinute)} per minute the session stays open past the first`,
  notes: [
    "Actions run in order and stop at the first failure.",
    "A `ref` stops being valid if the DOM changes order: ask for `controls` again.",
    "A session that is not yours answers 404, the same as one that does not exist.",
  ],
  example: {
    sessionId: "…",
    actions: [{ type: { ref: "input#0", text: "cloudflare workers" } }, { press: "Enter" }],
    formats: ["controls", "markdown"],
  },
});
