/**
 * The MCP surface: the same service, spoken in the language ChatGPT, Claude and
 * agent runtimes understand.
 *
 * Why it exists: a remote MCP server is the one surface a person reaches by pasting a URL
 * into a client, with nothing to install. What usually stops it being a product is that
 * there is no identity to charge — here there is: every call is billed to the key
 * travelling in `Authorization`, at the same prices as the HTTP API.
 *
 * It is JSON-RPC over a POST, stateless: listing and calling tools needs no SSE,
 * and with no state there is no transport session to keep alive.
 */

import { Hono, type Context } from "hono";
import {
  accountForKey,
  charge,
  credit,
  jobOwner,
  openFreeSessions,
  openSessions,
  registerJob,
  registerSession,
  sessionAccess,
  sessionOwner,
} from "./billing/accounts";
import { PRICES, inDollars, priceOfRequest } from "./billing/prices";
import {
  actRequest,
  batchRequest,
  crawlRequest,
  mapRequest,
  scrapeRequest,
  searchRequest,
  sessionRequest,
} from "./schema";
import { ENGINE, priceOfSearch, search, searchAvailable } from "./search/exa";
import { read, scrape } from "./scrape";
import { QuickActionsRenderer } from "./quick-actions";
import { CachedRenderer } from "./cached-renderer";
import { cacheable } from "./cache";
import {
  claimFreeCall,
  releaseFreeCall,
  explainRefusal,
  freeTable,
  FREE_EVER,
  FREE_MAX_AGE_MS,
  FREE_PER_DAY,
} from "./free-tier";
import type { FreeCall, FreeLeft } from "./free-tier";
import { origin } from "./http";
import { servedText } from "./landing";
import { PROMPTS, RESOURCES, freeLine, readResource } from "./mcp-resources";
import { VERSION } from "./version";
import { feedbackRequest } from "./feedback";
import { mapSite } from "./map";
import { FORMATS, type Env } from "./types";
import type { Message } from "./session/do";

/** What a keyless caller has left, in the words the answer carries. */
const noteFor = (left: FreeLeft): string =>
  `\n\n(Free tier left: ${left.scrape} reads and ${left.map} site listings today, ${left.sessions} session and ${left.searches} searches ever. A key or a wallet payment removes the limits.)`;

/** Version of the protocol we speak. */
const PROTOCOL = "2025-06-18";

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const commonSchema = {
  url: { type: "string", description: "Page to process." },
  maxAge: {
    type: "number",
    description:
      "Accept an answer up to this many milliseconds old. A cache hit costs $0.0002 instead of the format price. Leave it out to force a fresh render.",
  },
  formats: {
    type: "array",
    items: { type: "string", enum: [...FORMATS] },
    description:
      "Outputs you want in the same response. `controls` is the map of what can be clicked; `elements` needs `selectors`; `json` needs `json.prompt`.",
  },
  selectors: { type: "array", items: { type: "string" }, description: "CSS selectors for `elements`." },
  json: {
    type: "object",
    description: "For the `json` format: `prompt` and/or `schema`.",
    properties: { prompt: { type: "string" }, schema: { type: "object" } },
  },
  wait: {
    type: "object",
    description: "When to consider the page loaded: `until`, `selector`, `timeout`.",
    properties: {
      until: { type: "string", enum: ["load", "domcontentloaded", "networkidle0", "networkidle2"] },
      selector: { type: "string" },
      timeout: { type: "number" },
    },
  },
} as const;

const TOOLS = [
  {
    name: "web_scrape",
    annotations: {
      title: "Read a page or a document",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Processes a page and returns every output you ask for at once: markdown, html, links, screenshot, PDF, accessibility tree, elements by selector, AI-structured data, and `controls` (what can be clicked). One call, and a partial failure does not void the rest. From $0.001 per output. A url pointing at a PDF, Word, Excel or CSV file is converted to markdown instead, with no browser, for $0.002. Reference for the oassis API: https://oassis.dev/openapi.json",
    inputSchema: {
      type: "object",
      properties: { ...commonSchema, html: { type: "string", description: "Raw HTML instead of `url`." } },
      required: [],
    },
  },
  {
    name: "web_session_open",
    annotations: {
      title: "Open a browser session",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Opens a browser on a page and leaves it open, returning the map of controls. Use it when something has to be FILLED IN or CLICKED, not just read: inside the session the `controls` references keep working and you can act on the same state. $0.005 plus the outputs. Close it with web_session_close when you are done. Reference for the oassis API: https://oassis.dev/openapi.json",
    inputSchema: { type: "object", properties: commonSchema, required: ["url"] },
  },
  {
    name: "web_act",
    annotations: {
      title: "Act on an open page",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Runs actions against an open session and returns the resulting state. Actions: {navigate}, {click:{ref}}, {type:{ref,text,clear}}, {select:{ref,value}}, {press}, {scroll}, {wait}, {back}. The `ref` is the one `controls` gave you. It stops at the first failure and tells you where. $0.0005 per action. Reference for the oassis API: https://oassis.dev/openapi.json",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The one web_session_open returned." },
        actions: { type: "array", items: { type: "object" }, description: "Actions, in order." },
        ...commonSchema,
      },
      required: ["sessionId", "actions"],
    },
  },
  {
    name: "web_scrape_batch",
    annotations: {
      title: "Read a list of urls",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "A batch OF SCRAPES: reads a list of urls YOU give it (2 to 50, from any sites) and returns a jobId. It discovers nothing on its own — for that use web_crawl. Charged up front per url; urls that fail and urls served from the cache are refunded. Poll it with web_batch_status.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "The urls to read, 2 to 50. They do not have to share a site.",
        },
        formats: commonSchema.formats,
        selectors: commonSchema.selectors,
        json: commonSchema.json,
        wait: commonSchema.wait,
        maxAge: commonSchema.maxAge,
      },
      required: ["urls"],
    },
  },
  {
    name: "web_batch_status",
    annotations: {
      title: "Check or cancel a batch",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Checks a batch of scrapes: status, how many are done, and the results. Free. Pass `cancel: true` to stop it and get the urls it never read refunded.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        limit: { type: "number", description: "Results to return (default 50)." },
        cancel: { type: "boolean", description: "Stop the batch and refund what it did not read." },
      },
      required: ["jobId"],
    },
  },
  {
    name: "web_map",
    annotations: {
      title: "List a site's urls",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Every url of a site, fast and cheap: its sitemap plus, optionally, the links on the page. Use it BEFORE crawling, to see what is there and decide what is worth reading. $0.0003 with `includePage: false` (no browser at all), $0.0015 with the page. Reference for the oassis API: https://oassis.dev/openapi.json",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The site to map." },
        limit: { type: "number", description: "Urls to return (default 1000, max 5000)." },
        includePage: { type: "boolean", description: "Render the page too (default true)." },
        search: { type: "string", description: "Keep only urls containing this text." },
        includeSubdomains: { type: "boolean" },
        includePaths: { type: "array", items: { type: "string" } },
        excludePaths: { type: "array", items: { type: "string" } },
      },
      required: ["url"],
    },
  },
  {
    name: "web_crawl",
    annotations: {
      title: "Crawl a site",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Follows a site's links and reads every page. Returns a jobId; poll it with web_crawl_status. Charged up front for the pages it is allowed to read (`limit`), and the pages it never reads are refunded. Use web_map first if you only need the urls. Reference for the oassis API: https://oassis.dev/openapi.json",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Where to start." },
        limit: { type: "number", description: "Pages it may read (default 25, max 200)." },
        maxDepth: { type: "number", description: "How far to follow links (default 2, max 5)." },
        formats: commonSchema.formats,
        includeSubdomains: { type: "boolean" },
        includePaths: { type: "array", items: { type: "string" } },
        excludePaths: { type: "array", items: { type: "string" } },
        maxAge: commonSchema.maxAge,
      },
      required: ["url"],
    },
  },
  {
    name: "web_crawl_status",
    annotations: {
      title: "Check or cancel a crawl",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Checks a crawl: status, pages read, discovered and still queued, and the pages themselves. Free. Pass `cancel: true` to stop it and get the unread pages refunded.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        limit: { type: "number", description: "Pages to return (default 50)." },
        cancel: { type: "boolean", description: "Stop the crawl and refund what it did not read." },
      },
      required: ["jobId"],
    },
  },
  {
    name: "web_search_exa",
    annotations: {
      title: "Search the web",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Search the web with Exa's index: a query instead of a url, for when you do not know where to look. Returns title, url and a snippet per result. To read the pages, pass the urls to web_scrape_batch. The engine is named because the price is Exa's, passed through with no markup and read from its own payment challenge on every call — today $0.007 per search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for." },
        limit: { type: "number", description: "Results (default 10, max 50)." },
        snippets: { type: "boolean", description: "Text alongside each result (default true)." },
        domains: { type: "array", items: { type: "string" }, description: "Only these domains, subdomains included: `example.com` also matches `docs.example.com`." },
        excludeDomains: { type: "array", items: { type: "string" }, description: "Never these domains, subdomains included." },
        since: { type: "string", description: "Only results published after this ISO date." },
      },
      required: ["query"],
    },
  },
  {
    name: "web_feedback",
    annotations: {
      title: "Report a bad answer",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description:
      "Tell us an answer was good or bad. FREE. Use it when a result is wrong — empty markdown, a control map missing a button, data that does not match the page — with the url or the jobId so it can be reproduced. It is the only way we learn that we read a page badly: our logs cannot tell that apart from a page that is simply like that. Reference for the oassis API: https://oassis.dev/openapi.json",
    inputSchema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["good", "bad"] },
        route: { type: "string", description: "Which tool or endpoint it is about." },
        reference: { type: "string", description: "The jobId or sessionId it happened on." },
        url: { type: "string", description: "The page that came out wrong." },
        comment: { type: "string", description: "What you expected and what you got." },
      },
      required: ["verdict"],
    },
  },
  {
    name: "web_session_close",
    annotations: {
      title: "Close a session",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Closes a session and stops billing browser time. Free. If you do not close it, it closes itself after a minute without use.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

const ROUTE_FOR: Record<string, "scrape" | "session" | "act" | "map" | "crawl" | "batch" | "search"> = {
  web_scrape: "scrape",
  web_session_open: "session",
  web_act: "act",
  web_map: "map",
  web_crawl: "crawl",
  web_scrape_batch: "batch",
  web_search_exa: "search",
};

export const mcp = new Hono<{ Bindings: Env }>();

mcp.post("/mcp", async (c) => {
  let rpc: RpcRequest;
  try {
    rpc = (await c.req.json()) as RpcRequest;
  } catch {
    return c.json(rpcError(null, -32700, "The body must be JSON-RPC."), 400);
  }

  const { id = null, method, params = {} } = rpc;

  switch (method) {
    case "initialize":
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL,
          // Declaring only tools is what made the directories file this server as
          // incomplete; it also meant a client could not read the catalogue it is told to.
          capabilities: { tools: {}, resources: {}, prompts: {} },
          /**
           * The same identity the official registry lists, `dev.oassis/web` 1.0.0.
           * Announcing a different name and version here meant a client saw one server
           * and the directory that sent it another.
           */
          serverInfo: {
            name: "oassis",
            title: "oassis — web scraping, crawling and browser control for AI agents",
            version: VERSION,
            /** So a client draws the mark instead of guessing at a favicon. */
            icons: [{ src: `${origin(c)}/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] }],
          },
          instructions: [
            "Web extraction and browser control for agents.",
            `You can try it with no key and no account: ${FREE_PER_DAY.scrape} page or document reads a day, ${FREE_PER_DAY.map} site listings a day, and — once, ever — one browser session with ${FREE_EVER.actions} actions and ${FREE_EVER.searches} searches. Crawls, batches and AI extraction need a key. Call GET /mcp for the table.`,
            "After that, send an API key in `Authorization: Bearer oas_…`, or pay per call with a wallet over the HTTP API (x402, USDC on Base) with no account at all.",
            "To read a page use web_scrape; to fill in or click something, open a session with web_session_open and act with web_act; to find urls use web_map before paying to read them.",
          ].join(" "),
        },
      });

    // Notifications: no response.
    case "notifications/initialized":
    case "notifications/cancelled":
      return c.body(null, 202);

    case "ping":
      return c.json({ jsonrpc: "2.0", id, result: {} });

    case "tools/list":
      return c.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });

    case "tools/call":
      return callTool(c, id, params);

    case "resources/list":
      return c.json({ jsonrpc: "2.0", id, result: { resources: RESOURCES } });

    case "resources/read": {
      const uri = String((params as { uri?: unknown })?.uri ?? "");
      const found = readResource(c, uri);
      if (!found) return c.json(rpcError(id, -32602, `No resource at ${uri || "(no uri given)"}`));
      return c.json({
        jsonrpc: "2.0",
        id,
        result: { contents: [{ uri, mimeType: found.mimeType, text: found.text }] },
      });
    }

    case "prompts/list":
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          prompts: PROMPTS(c).map(({ name, title, description, arguments: args }) => ({
            name,
            title,
            description,
            arguments: args,
          })),
        },
      });

    case "prompts/get": {
      const want = String((params as { name?: unknown })?.name ?? "");
      const prompt = PROMPTS(c).find((p) => p.name === want);
      if (!prompt) return c.json(rpcError(id, -32602, `No prompt called ${want || "(none given)"}`));
      const args = ((params as { arguments?: Record<string, string> })?.arguments ?? {}) as Record<string, string>;
      return c.json({
        jsonrpc: "2.0",
        id,
        result: {
          description: prompt.description,
          messages: [
            {
              role: "user",
              content: { type: "text", text: `${prompt.text(args)} ${freeLine()}` },
            },
          ],
        },
      });
    }

    default:
      return c.json(rpcError(id, -32601, `Unsupported method: ${method}`));
  }
});

// A GET on /mcp is not a client mistake: it is someone looking with a browser. It never
// changes between deploys, so it is cacheable like the other documents.
mcp.get("/mcp", (c) =>
  c.json(
    {
      transport: "MCP over JSON-RPC on POST /mcp (stateless)",
      protocolVersion: PROTOCOL,
      auth: "Authorization: Bearer oas_…",
      /**
       * The allowance in calls, which is the unit a caller plans in. It is one shared
       * allowance, so these are maximums: spending it on pages leaves none for a crawl.
       */
      /**
       * A demo, not a plan: enough to see whether this is any good, shaped by the first
       * thirty seconds rather than by what is cheap. Anyone who wants more can pay per call
       * with a wallet and no account.
       */
      free: {
        forWho: "MCP clients, with no key and no account",
        shape: "A demo. Each limit is its own, not a shared pool.",
        allowance: freeTable(),
      },
      tools: TOOLS.map((t) => t.name),
    },
    200,
    { "cache-control": "public, max-age=3600" },
  ),
);

async function callTool(
  c: Context<{ Bindings: Env }>,
  id: string | number | null,
  params: Record<string, unknown>,
): Promise<Response> {
  const name = params.name as ToolName | undefined;
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  if (!name || !TOOLS.some((t) => t.name === name)) {
    return c.json(rpcError(id, -32602, `There is no tool called \`${name}\`.`));
  }

  /** Checking or cancelling a batch is free, same as a crawl. */
  if (name === "web_batch_status") {
    const jobId = String(args.jobId ?? "");
    if (!jobId) return c.json(rpcError(id, -32602, "`jobId` is required."));
    const who = await callerAccount(c);
    if (who === "invalid") return c.json(toolResult(id, "Invalid or revoked key.", true));
    if (sessionAccess(await jobOwner(c.env.BILLING, jobId), who) !== "ok") {
      return c.json(toolResult(id, "That batch does not exist or is not yours.", true));
    }
    const stub = c.env.JOBS.get(c.env.JOBS.idFromString(jobId));
    const res = await stub.fetch("https://job/", {
      method: "POST",
      body: JSON.stringify(
        args.cancel === true
          ? { kind: "cancel" }
          : { kind: "status", limit: Math.min(50, Number(args.limit ?? 50) || 50) },
      ),
      headers: { "content-type": "application/json" },
    });
    return c.json(toolResult(id, await res.text(), !res.ok));
  }

  /**
   * Checking a crawl is free, like every other read of your own state. Cancelling is
   * free too: charging to stop spending would be a crooked incentive.
   */
  if (name === "web_crawl_status") {
    const jobId = String(args.jobId ?? "");
    if (!jobId) return c.json(rpcError(id, -32602, "`jobId` is required."));
    const who = await callerAccount(c);
    if (who === "invalid") return c.json(toolResult(id, "Invalid or revoked key.", true));
    if (sessionAccess(await jobOwner(c.env.BILLING, jobId), who) !== "ok") {
      return c.json(toolResult(id, "That crawl does not exist or is not yours.", true));
    }
    const stub = c.env.CRAWLS.get(c.env.CRAWLS.idFromString(jobId));
    const res = await stub.fetch("https://crawl/", {
      method: "POST",
      body: JSON.stringify(
        args.cancel === true
          ? { kind: "cancel" }
          : { kind: "status", limit: Math.min(50, Number(args.limit ?? 50) || 50) },
      ),
      headers: { "content-type": "application/json" },
    });
    return c.json(toolResult(id, await res.text(), !res.ok));
  }

  /** Reporting a bad answer is free: paying to tell us we are broken makes no sense. */
  if (name === "web_feedback") {
    const who = await callerAccount(c);
    if (who === "invalid") return c.json(toolResult(id, "Invalid or revoked key.", true));
    if (!who) {
      return c.json(
        toolResult(
          id,
          "Send your API key in `Authorization: Bearer oas_…` so we can follow up on what you report.",
          true,
        ),
      );
    }
    const parsed = feedbackRequest.safeParse(args);
    if (!parsed.success) return c.json(toolResult(id, issuesText(parsed.error.issues), true));
    const { verdict, route: about, reference, url, comment } = parsed.data;
    await c.env.BILLING.prepare(
      `INSERT INTO feedback (account, at, verdict, route, reference, url, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(who, Date.now(), verdict, about ?? "mcp", reference ?? null, url ?? null, comment ?? null)
      .run();
    return c.json(toolResult(id, "Logged. Thank you."));
  }

  // Closing a session is free: charging to stop spending would be a crooked
  // incentive. It still has to be your session, so the key is resolved here even
  // though nothing is billed.
  if (name === "web_session_close") {
    const sessionId = String(args.sessionId ?? "");
    if (!sessionId) return c.json(rpcError(id, -32602, "`sessionId` is required."));
    const closer = await callerAccount(c);
    if (closer === "invalid") return c.json(toolResult(id, "Invalid or revoked key.", true));
    const denied = await notYours(c, sessionId, closer);
    if (denied) return c.json(toolResult(id, denied, true));
    const res = await callSession(c, sessionId, { kind: "close" });
    return c.json(toolResult(id, await res.text()));
  }

  const route = ROUTE_FOR[name] as "scrape" | "session" | "act" | "map" | "crawl" | "batch" | "search";

  /**
   * Search is priced by Exa, not by us: the amount comes from its own payment challenge,
   * which is free to ask for.
   */
  let micros: number;
  if (route === "search") {
    if (!searchAvailable(c.env)) {
      return c.json(
        toolResult(id, "Search is not configured on this deployment: there is no wallet to pay Exa with.", true),
      );
    }
    const wanted = searchRequest.safeParse(args);
    if (!wanted.success) return c.json(toolResult(id, issuesText(wanted.error.issues), true));
    try {
      micros = await priceOfSearch(wanted.data);
    } catch {
      return c.json(toolResult(id, "Could not read the search provider's price. Nothing was charged.", true));
    }
  } else {
    micros = priceOfRequest(route, args as never);
  }
  const sessionOf = typeof args.sessionId === "string" ? args.sessionId : "";

  /**
   * Two ways to pay for a tool call here. A key is charged to its balance; without one, the
   * call is taken out of the day's free budget — MCP has no 402 challenge a wallet could
   * answer, so this is the only door a stranger has, and the one most people arrive by.
   *
   * From here on, `payer` is either an account id or null, meaning the free tier paid.
   */
  const key = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let payer: string | null = null;
  let note = "";
  /** What the free tier was charged, kept so a failure can put it back. */
  let freeCall: { caller: { ip: string }; call: FreeCall } | null = null;

  if (key) {
    const account = await accountForKey(c.env.BILLING, key);
    if (!account) return c.json(toolResult(id, "Invalid or revoked key.", true));

    if (route === "session") {
      const open = await openSessions(c.env.BILLING, account.id);
      if (open >= account.maxSessions) {
        return c.json(
          toolResult(
            id,
            `You already have ${open} open sessions, your account's maximum. Close one with web_session_close.`,
            true,
          ),
        );
      }
    }

    // Checked before charging: turning someone away after taking their money would be
    // charging for a door we slammed ourselves.
    if (route === "act") {
      const denied = await notYours(c, sessionOf, account.id);
      if (denied) return c.json(toolResult(id, denied, true));
    }

    const balance = await charge(c.env.BILLING, account.id, {
      concept: `mcp:${name}`,
      micros,
      route: "/mcp",
    });
    if (balance === null) {
      return c.json(
        toolResult(
          id,
          `This call costs ${inDollars(micros)} and your balance is ${inDollars(account.balanceMicros)}. Top up to continue.`,
          true,
        ),
      );
    }
    payer = account.id;
  } else {
    const caller = {
      ip: c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown",
      userAgent: c.req.header("user-agent"),
    };
    const call: FreeCall = {
      tool: name,
      micros,
      url: typeof args.url === "string" ? args.url : undefined,
      formats: args.formats,
      sessionsOpen: route === "session" ? await openFreeSessions(c.env.BILLING) : 0,
    };
    const claim = await claimFreeCall(c.env, caller, call);
    if (claim.ok) freeCall = { caller, call };

    if (!claim.ok) {
      // No counter at all means this deployment has no free tier: say so in terms of paying.
      if (claim.reason === "no_counter") {
        return c.json(
          toolResult(
            id,
            `This call costs ${inDollars(micros)} and needs an API key. Send it in the \`Authorization: Bearer oas_…\` header of your MCP client, or pay per call with a wallet over the HTTP API (x402).`,
            true,
          ),
        );
      }
      return c.json(toolResult(id, explainRefusal(claim.reason, inDollars(micros)), true));
    }

    if (route === "act") {
      const denied = await notYours(c, sessionOf, null);
      if (denied) return c.json(toolResult(id, denied, true));
    }

    // What is left, per operation, because that is what a caller plans with.
    note = noteFor(claim.left);
  }

  /** Every answer from here carries the free-tier note, when there is one. */
  const finish = (text: string, isError = false) => c.json(toolResult(id, text + note, isError));

  /**
   * Undoes the payment when the work did not happen: a key gets its balance back, and the
   * free tier gets its call back. Never throws: a failed give-back must not turn an error
   * the caller can read into a 500 they cannot.
   */
  /** Gives back the whole charge, or `parte` of it when only some of the work was skipped. */
  const giveBack = async (reason: string, parte?: number) => {
    if (payer) {
      await credit(c.env.BILLING, payer, parte ?? micros, reason).catch(() => null);
    } else if (parte !== undefined) {
      // A free call has no money to return in parts: the allowance is spent per call.
      return;
    } else if (freeCall) {
      // The note was written when the call was charged, so it has to be written again.
      const left = await releaseFreeCall(c.env, freeCall.caller, freeCall.call).catch(() => null);
      if (left) note = noteFor(left);
    }
  };

  /**
   * Arguments that do not parse: nothing was attempted, so nothing is owed.
   *
   * Over HTTP the guard validates before charging — "nothing invalid ever reaches a
   * charge". Over MCP the charge happens first, because the price depends on the
   * arguments, and these eight rejections kept the money: asking for a batch of one url,
   * which the schema refuses, cost $0.001 for a request that never ran. The two doors
   * disagreed, again.
   */
  const rechazar = async (issues: Parameters<typeof issuesText>[0]) => {
    await giveBack("refund: the request was not valid");
    return finish(issuesText(issues), true);
  };

  try {
    if (name === "web_scrape") {
      const parsed = scrapeRequest.safeParse(args);
      if (!parsed.success) return rechazar(parsed.error.issues);
      /**
       * A free answer accepts an hour-old one from the cache. It is the difference between a
       * swarm asking for the same popular pages costing one render or thousands, and an hour
       * is no worse than what a paying caller asks for with `maxAge` anyway.
       */
      const req = payer
        ? parsed.data
        : { ...parsed.data, maxAge: Math.max(parsed.data.maxAge ?? 0, FREE_MAX_AGE_MS) };
      const provider = new QuickActionsRenderer(c.env.BROWSER);
      const res = await read(
        req,
        cacheable(req) ? new CachedRenderer(c.env, provider, req.maxAge ?? 0) : provider,
        c.env,
      );
      // Nothing came back, nothing to pay for — same rule as over HTTP.
      if (!res.success) await giveBack("refund: nothing came back");
      return finish(JSON.stringify(res), !res.success);
    }

    if (name === "web_session_open") {
      const parsed = sessionRequest.safeParse(args);
      if (!parsed.success) return rechazar(parsed.error.issues);
      const sessionId = c.env.SESSIONS.newUniqueId().toString();
      await registerSession(c.env.BILLING, sessionId, payer, payer ? "key" : "free");
      const res = await callSession(c, sessionId, { kind: "open", req: parsed.data });
      return finish(await res.text(), !res.ok);
    }

    if (name === "web_search_exa") {
      const parsed = searchRequest.safeParse(args);
      if (!parsed.success) return rechazar(parsed.error.issues);
      try {
        const { results } = await search(c.env, parsed.data);
        return finish(JSON.stringify({ engine: ENGINE, results }));
      } catch (e) {
        // Paid before the work, and the work did not happen. The reason is ours to read,
        // not the caller's: it can name the wallet and how this deployment is configured.
        await giveBack("refund: search failed");
        console.error(`search: ${e instanceof Error ? e.message : String(e)}`);
        return finish("The search could not be completed, so you were not charged.", true);
      }
    }

    if (name === "web_scrape_batch") {
      const parsed = batchRequest.safeParse(args);
      if (!parsed.success) return rechazar(parsed.error.issues);
      const jobId = c.env.JOBS.newUniqueId().toString();
      await registerJob(c.env.BILLING, jobId, payer, payer ? "key" : "free", parsed.data.urls.length, micros);
      const stub = c.env.JOBS.get(c.env.JOBS.idFromString(jobId));
      const res = await stub.fetch("https://job/", {
        method: "POST",
        body: JSON.stringify({
          kind: "create",
          req: parsed.data,
          account: payer,
          chargedMicros: micros,
        }),
        headers: { "content-type": "application/json" },
      });
      return finish(await res.text(), !res.ok);
    }

    if (name === "web_map") {
      const parsed = mapRequest.safeParse(args);
      if (!parsed.success) return rechazar(parsed.error.issues);
      const res = await mapSite(parsed.data, async () => {
        const page = await scrape(
          { ...parsed.data, formats: ["links"], binaryAs: "base64" } as never,
          new QuickActionsRenderer(c.env.BROWSER),
        );
        return Array.isArray(page.data.links) ? (page.data.links as string[]) : [];
      }, servedText(c));
      // Same rule as scrape, and as the HTTP route: nothing found, nothing to pay for.
      if (res.urls.length === 0) await giveBack("refund: nothing to map");
      return finish(JSON.stringify(res), res.urls.length === 0);
    }

    if (name === "web_crawl") {
      const parsed = crawlRequest.safeParse(args);
      if (!parsed.success) return rechazar(parsed.error.issues);
      const jobId = c.env.CRAWLS.newUniqueId().toString();
      await registerJob(c.env.BILLING, jobId, payer, payer ? "key" : "free", parsed.data.limit, micros);
      const stub = c.env.CRAWLS.get(c.env.CRAWLS.idFromString(jobId));
      const res = await stub.fetch("https://crawl/", {
        method: "POST",
        body: JSON.stringify({
          kind: "create",
          req: parsed.data,
          account: payer,
          chargedMicros: micros,
        }),
        headers: { "content-type": "application/json" },
      });
      return finish(await res.text(), !res.ok);
    }

    const parsed = actRequest.safeParse(args);
    if (!parsed.success) return rechazar(parsed.error.issues);
    const { sessionId, actions, ...rest } = parsed.data;
    const req = sessionRequest.safeParse({ ...rest, url: rest.url ?? "https://placeholder.invalid" });
    if (!req.success) return rechazar(req.error.issues);
    const res = await callSession(c, sessionId, { kind: "act", actions, req: req.data });
    const texto = await res.text();

    /**
     * Actions are charged up front, all of them, because that is what lets the price be
     * quoted before the work. But they stop at the first failure, so a request of twenty
     * whose first one fails was charged for twenty and did one. The answer says how many
     * were attempted, and the difference goes back.
     *
     * The attempted one stays charged even when it failed: the browser did the work of
     * trying. What is given back is the work nobody did.
     */
    try {
      const body = JSON.parse(texto) as { actions?: unknown[] };
      const corridas = Array.isArray(body.actions) ? body.actions.length : actions.length;
      const sobrantes = actions.length - corridas;
      if (sobrantes > 0) await giveBack(`refund: ${sobrantes} action(s) never ran`, sobrantes * PRICES.action);
    } catch {
      /* an unreadable answer says nothing about how much to give back */
    }

    return finish(texto, !res.ok);
  } catch (e) {
    console.error(`mcp ${name}: ${e instanceof Error ? e.message : String(e)}`);
    return finish("The call could not be completed.", true);
  }
}

/** The account behind the key, `null` when none was sent, "invalid" when it is bad. */
async function callerAccount(c: Context<{ Bindings: Env }>): Promise<string | null | "invalid"> {
  const key = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!key) return null;
  const account = await accountForKey(c.env.BILLING, key);
  return account ? account.id : "invalid";
}

/**
 * A session that is not yours reads exactly like one that does not exist, so this
 * cannot be used to discover which session ids are alive.
 */
async function notYours(
  c: Context<{ Bindings: Env }>,
  sessionId: string,
  caller: string | null,
): Promise<string | null> {
  const access = sessionAccess(await sessionOwner(c.env.BILLING, sessionId), caller);
  if (access === "ok") return null;
  return "That session does not exist, is already closed, or is not yours.";
}

function callSession(c: Context<{ Bindings: Env }>, sessionId: string, message: Message): Promise<Response> {
  const stub = c.env.SESSIONS.get(c.env.SESSIONS.idFromString(sessionId));
  return stub.fetch("https://session/", {
    method: "POST",
    body: JSON.stringify(message),
    headers: { "content-type": "application/json" },
  });
}

/** A tool result: text, marked as a failure when it is one. */
function toolResult(id: string | number | null, text: string, isError = false) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) },
  };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}

function issuesText(issues: { path: (string | number)[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}
