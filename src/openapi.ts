/**
 * The machine-readable catalogue: `/openapi.json` and `/llms.txt`.
 *
 * Both are **generated from the same objects the endpoints answer their own GET with**, so
 * there is no second copy of the documentation to fall out of date. The types come from the
 * house style those docs are written in — `"string — page to process"`, `"array — …"`,
 * `"{ fullPage, type }"` — and a test fails if a field is ever written in a way that cannot
 * be typed, which is the only way this stays honest without a schema compiler.
 *
 * It exists for discovery. A directory, a crawler or an agent that finds this API has no
 * manual to read: this is the manual, and it carries the price and the payment terms of
 * every route, which is what tells them there is something to buy here.
 */

import type { Context } from "hono";
import { actDoc, batchDoc, crawlDoc, doc, mapDoc, searchDoc, sessionDoc } from "./docs";
import { origin, prefixForHost } from "./http";
import { PER_FORMAT, PRICES, inDollars, mapPrice } from "./billing/prices";
import { VERSION } from "./version";
import type { Env } from "./types";

/** The page written for a person. Everything else here is for a machine. */
const SITE = "https://oassis.dev";

/** USDC on Base. The asset every price on this API is quoted and paid in. */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

interface Doc {
  endpoint?: string;
  endpoints?: Record<string, string>;
  description?: string;
  request?: Record<string, string>;
  response?: Record<string, string>;
  price?: string;
  notes?: string[];
  example?: Record<string, unknown>;
  actions?: unknown;
}

/**
 * Every paid route, with the doc that describes it, the tool that fronts it in MCP, and
 * where its price starts. "Computed from the request" is true and useless to a directory
 * deciding whether to list you: the cheapest real call is a number, and it comes from the
 * same table the charge does.
 */
const PAID = [
  { path: "scrape", build: doc, tool: "web_scrape", summary: "Read a page or a document", from: PER_FORMAT.markdown },
  { path: "session", build: sessionDoc, tool: "web_session_open", summary: "Open a browser session", from: PRICES.sessionOpen },
  { path: "act", build: actDoc, tool: "web_act", summary: "Act on an open browser session", from: PRICES.action },
  { path: "scrape/batch", build: batchDoc, tool: "web_scrape_batch", summary: "Read a list of urls", from: PER_FORMAT.markdown },
  { path: "map", build: mapDoc, tool: "web_map", summary: "List a site's urls", from: mapPrice(false) },
  { path: "crawl", build: crawlDoc, tool: "web_crawl", summary: "Follow a site's links and read it", from: PER_FORMAT.markdown },
  { path: "search", build: searchDoc, tool: "web_search_exa", summary: "Search the web", from: 7_000 },
] as const;

/**
 * The type a field is written as. The docs describe each field in one consistent shape, so
 * the first token carries the type and the rest is the description a reader wants.
 */
export function fieldType(prose: string): { type: string; description: string } | null {
  const text = prose.trim();
  const named = /^(string|number|boolean|array of string|array|object)\b/i.exec(text);
  if (named) {
    const word = named[1]!.toLowerCase();
    const rest = text.slice(named[0].length).replace(/^\s*[—-]\s*/, "").trim();
    if (word === "array of string") return { type: "array", description: rest || text };
    return { type: word === "array" ? "array" : word, description: rest || text };
  }
  // `{ fullPage, type, quality }` — an object, and the field names are the description.
  if (text.startsWith("{")) return { type: "object", description: text };
  // Prose with no type at all is still useful to a reader, and is typed as a string.
  if (/^[a-z]/i.test(text)) return { type: "string", description: text };
  return null;
}

function properties(request: Record<string, string> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, prose] of Object.entries(request ?? {})) {
    const typed = fieldType(prose);
    if (!typed) continue;
    out[name] = { type: typed.type, description: typed.description };
  }
  return out;
}

/** The OpenAPI document, built for whoever is asking: the host decides the paths. */
/**
 * Agent tasks are paid from an account balance, not per request over x402, so they carry no
 * x-x402 quote. They need an API key, and the reserve is stated where a caller reads the price.
 */
function agentTaskPaths(base: string): Record<string, unknown> {
  const bearer = [{ bearerAuth: [] }];
  const unauthorized = { "401": { description: "No key, or an invalid or revoked key." } };
  const notFound = { "404": { description: "No task with that id belongs to this account." } };
  return {
    [`${base}/agent/v1/tasks`]: {
      post: {
        summary: "Start a research task",
        description:
          "Answers a question by reading public pages, with sources, progress and cost. The budget in limits.max_cost_usd is reserved before the task starts; the unused part is returned when it ends. Requires an API key with a balance. Send Idempotency-Key to retry safely.",
        operationId: "web_task_start",
        security: bearer,
        parameters: [
          { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 }, description: "Same key and same request return the same task. Same key with a different request is refused with 409." },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["task"],
                additionalProperties: false,
                properties: {
                  task: { type: "string", minLength: 10, maxLength: 2000, description: "What to find out." },
                  mode: { type: "string", enum: ["research"], default: "research" },
                  urls: { type: "array", maxItems: 5, items: { type: "string", format: "uri" }, default: [] },
                  limits: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      max_cost_usd: { type: "number", minimum: 0.01, maximum: 1, default: 0.1 },
                      max_duration_seconds: { type: "integer", minimum: 30, maximum: 900, default: 180 },
                      max_steps: { type: "integer", minimum: 1, maximum: 20, default: 10 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "202": { description: "Accepted. The Location header points at the task. Body: task_id, status, location, replayed." },
          "400": { description: "The request does not match the contract. Unknown fields and unsupported modes are refused." },
          "402": { description: "The available balance does not cover the reserve." },
          "409": { description: "The Idempotency-Key was used with a different request." },
          ...unauthorized,
        },
        "x-mcp-tool": "web_task_start",
      },
    },
    [`${base}/agent/v1/tasks/{task_id}`]: {
      get: {
        summary: "Read a task",
        description:
          "Status, progress, operations, sources with the evidence used, limitations, the result when there is one, and billing: reserved, spent, released and settlement.",
        operationId: "web_task_status",
        security: bearer,
        parameters: [{ name: "task_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "The task." }, ...notFound, ...unauthorized },
        "x-mcp-tool": "web_task_status",
      },
    },
    [`${base}/agent/v1/tasks/{task_id}/cancel`]: {
      post: {
        summary: "Cancel a task",
        description:
          "Stops new operations and returns the unused budget. An operation already running cannot always be stopped remotely: it is charged as it completes. Cancelling a finished task changes nothing.",
        operationId: "web_task_cancel",
        security: bearer,
        parameters: [{ name: "task_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "202": { description: "Cancellation requested, or the task as it already was." }, ...notFound, ...unauthorized },
        "x-mcp-tool": "web_task_cancel",
      },
    },
  };
}

export function openapi(c: Context<{ Bindings: Env }>): Record<string, unknown> {
  const base = origin(c);
  const family = prefixForHost(c);
  const payTo = c.env.X402_PAY_TO;
  const network = (c.env.X402_NETWORK ?? "base") === "base" ? "eip155:8453" : "eip155:84532";

  const paths: Record<string, unknown> = { ...agentTaskPaths(base) };
  for (const { path, build, tool, summary, from } of PAID) {
    const described = build(c) as Doc;
    /** Some routes document a family of paths rather than one, and carry no single line. */
    const about = described.description ?? Object.values(described.endpoints ?? {})[0] ?? summary;
    const full = `${family}/${path}`;
    paths[full] = {
      get: {
        summary: `What ${full} expects`,
        description: "Free and cacheable: the endpoint describes itself, so no key is needed to read it.",
        responses: { "200": { description: "The description of this endpoint." } },
      },
      post: {
        summary,
        description: about,
        operationId: tool,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: properties(described.request) },
              ...(described.example ? { example: described.example } : {}),
            },
          },
        },
        responses: {
          "200": { description: Object.entries(described.response ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "The result." },
          "402": { description: "Payment required. The challenge travels in the PAYMENT-REQUIRED header." },
        },
        /**
         * What it costs and how to pay it, where a directory looks for it. The price is the
         * one the 402 challenge quotes, because both are computed from the same request.
         */
        "x-x402": {
          scheme: "exact",
          network,
          asset: USDC_BASE,
          ...(payTo ? { payTo } : {}),
          price: described.price ?? `from ${inDollars(from)}`,
          note: "POST the route unpaid to be quoted the exact price of that call.",
        },
        "x-mcp-tool": tool,
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "oassis — web scraping, crawling and browser control for AI agents",
      version: VERSION,
      description:
        "Scrape any page or document to markdown, map and crawl whole sites, drive a real browser, " +
        "and search the web. " +
        "Pay per call with a wallet and no account at all (x402, USDC on Base), or with an API key. " +
        "POST any route unpaid and it answers 402 with the exact price of that call.",
      "x-mcp": `${base}/mcp`,
      "x-logo": { url: `${origin(c)}/icon-512.png`, altText: "oassis" },
    },
    servers: [{ url: base }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "An API key: Authorization: Bearer oas_…" } } },
    /** Where a person goes. The rest of this document is for whatever is reading it. */
    externalDocs: { description: "oassis", url: SITE },
    paths,
    "x-payment": {
      protocol: "x402",
      version: 2,
      network,
      asset: USDC_BASE,
      ...(payTo ? { payTo } : {}),
      note: "No account, no card, no signup: answer the 402 challenge and the call runs.",
    },
  };
}

/** The same catalogue as plain text, for whoever reads with a model instead of a parser. */
export function llmsTxt(c: Context<{ Bindings: Env }>): string {
  const spec = openapi(c) as {
    info: { title: string; description: string };
    paths: Record<string, { post: { summary: string; description: string; "x-x402": { price: string }; "x-mcp-tool": string } }>;
  };
  const base = origin(c);

  const lines = [
    "# oassis",
    "",
    `> ${spec.info.description}`,
    "",
    "## How to pay",
    "",
    "- **Wallet (no account):** POST any endpoint below. It answers `402` with the price of that",
    "  exact call in the `PAYMENT-REQUIRED` header, in USDC on Base. Pay it and repeat the call.",
    "- **API key:** `Authorization: Bearer oas_…`, charged against a prepaid balance.",
    "- Nothing is charged for work that did not happen: a failure refunds, and an unpaid",
    "  challenge is a quote, not a charge.",
    "",
    "## Endpoints",
    "",
  ];

  for (const [path, op] of Object.entries(spec.paths)) {
    const post = (op as { post?: { description: string; "x-x402"?: { price: string }; "x-mcp-tool": string } }).post;
    if (!post?.["x-x402"]) continue;
    lines.push(`### POST ${path}`);
    lines.push("");
    lines.push(post.description);
    lines.push("");
    lines.push(`- Price: ${post["x-x402"].price}`);
    lines.push(`- MCP tool: \`${post["x-mcp-tool"]}\``);
    lines.push(`- What it expects: GET ${path} (free)`);
    lines.push("");
  }

  lines.push("## Agent tasks");
  lines.push("");
  lines.push(
    "A research task answers a question from public pages, with sources, progress and cost. Tasks need an API key with a balance: the budget is reserved when the task starts, and the unused part is returned when it ends.",
  );
  lines.push("");
  lines.push(`- POST ${base}/agent/v1/tasks: start a task (202, with a Location header)`);
  lines.push(`- GET ${base}/agent/v1/tasks/{task_id}: read status, sources, result and billing`);
  lines.push(`- POST ${base}/agent/v1/tasks/{task_id}/cancel: stop a task and return the unused budget`);
  lines.push("- MCP tools: web_task_start, web_task_status, web_task_cancel");
  lines.push("");

  lines.push("## MCP");
  lines.push("");
  lines.push(`Streamable HTTP at \`${base}/mcp\`. Every tool works without a key, except \`web_search_exa\`, which is paid.`);
  lines.push("");
  lines.push("## Machine-readable");
  lines.push("");
  lines.push(`- Site, for a person: ${SITE}`);
  lines.push(`- OpenAPI: ${base}/openapi.json`);
  lines.push(`- This file: ${base}/llms.txt`);
  lines.push("");

  return lines.join("\n");
}
