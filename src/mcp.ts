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
  credit,
  charge,
  requestAccount,
  jobOwner,
  registerJob,
  closeSession,
  registerSession,
  sessionAccess,
  sessionOwner,
} from "./billing/accounts";
import { PRICES, priceOfRequest } from "./billing/prices";
import {
  LIGHT_FORMATS,
  actRequest,
  batchRequest,
  crawlRequest,
  mapRequest,
  scrapeRequest,
  searchRequest,
  sessionRequest,
} from "./schema";
import { PROSE, fichaDe } from "./mcp-schema";
import { ENGINE, priceOfSearch, search, searchAvailable } from "./search/exa";
import { read, scrape } from "./scrape";
import { QuickActionsRenderer } from "./quick-actions";
import { CachedRenderer } from "./cached-renderer";
import { cacheable } from "./cache";

import { origin } from "./http";
import { servedText } from "./landing";
import { checkFreeCall } from "./free-tier";
import { PROMPTS, RESOURCES, freeLine, readResource } from "./mcp-resources";
import { VERSION } from "./version";
import { feedbackRequest, storeFeedback } from "./feedback";
import { CREDIT_GUIDE, creditsFor } from "./billing/credits";
import { trialIdentity, takeTrial, refundTrial } from "./billing/trial";
import { startTask, getTask, cancelTask } from "./agent/service";
import { publicTask } from "./agent/public-access";
import { taskRequest } from "./agent/request";
import { mapSite } from "./map";
import type { Env } from "./types";
import type { Message } from "./session/do";

/** What a keyless caller has left, in the words the answer carries. */

/** Version of the protocol we speak. */
const PROTOCOL = "2025-06-18";

/**
 * Versions we answer in, newest first.
 *
 * The spec is explicit: if the server supports the version the client asked for, it
 * **must** answer with that same one, and only otherwise with one of its own. We
 * answered `2025-06-18` to everybody — a client asking for `2025-03-26` was told a
 * version it had not asked for and is supposed to hang up, even though nothing in this
 * server needs the newer one. A directory validator asks exactly that question.
 */
const SPOKEN: readonly string[] = [PROTOCOL, "2025-03-26", "2024-11-05"];

/** The version to answer with: theirs when we speak it, ours when we do not. */
function agreedProtocol(asked: unknown): string {
  return typeof asked === "string" && SPOKEN.includes(asked) ? asked : PROTOCOL;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * The shape of every tool, derived from the schema that validates it.
 *
 * `web_act` is the one that needs saying: it validates with `passthrough()` and hands the
 * rest of the body to the session schema, so its own shape is only `sessionId` and
 * `actions`. Generating from it alone would publish two properties and hide fifteen.
 *
 * `html` is left out of both session tools because both reject it by name: a session
 * navigates, so there is nothing to apply raw html to.
 */
const DE_SESION = fichaDe(sessionRequest, { omit: ["html"] }).properties;

/** Published for a batch and a crawl: both refuse the heavy formats, so neither offers them. */
const FORMATOS_LIGEROS = {
  type: "array",
  items: { type: "string", enum: [...LIGHT_FORMATS] },
  description: `${PROSE.formats} A screenshot or a PDF is not available here: every result is kept until you collect it. Ask for those one url at a time on web_scrape.`,
};

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
      "Processes a page and returns every output you ask for at once: markdown, html, links, screenshot, PDF, accessibility tree, elements by selector, AI-structured data, and `controls` (what can be clicked). One call, and a partial failure does not void the rest. From 1 credit ($0.002) per output. A url pointing at a PDF, Word, Excel or CSV file is converted to markdown instead, with no browser, for $0.002. Reference for the oassis API: https://oassis.dev/openapi.json",
    inputSchema: fichaDe(scrapeRequest),
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
    inputSchema: fichaDe(sessionRequest, { omit: ["html"], required: ["url"] }),
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
    inputSchema: fichaDe(actRequest, { extra: DE_SESION, omit: ["html"] }),
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
      "A batch OF SCRAPES: reads a list of urls YOU give it (2 to 50, from any sites) and returns a jobId. It discovers nothing on its own — for that use web_crawl. API key and credits required. Poll it with web_batch_status.",
    inputSchema: fichaDe(batchRequest, { narrow: { formats: FORMATOS_LIGEROS } }),
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
      "Checks a batch of scrapes: status, how many are done, and the results. Free for the owning account. Pass `cancel: true` to stop it.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "The batch, from web_scrape_batch." },
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
      "Every url of a site, fast and cheap: its sitemap plus, optionally, the links on the page. Use it BEFORE crawling, to see what is there and decide what is worth reading. 1 credit ($0.002) with `includePage: false` (no browser at all), 1.5 credits ($0.003) with the page. Reference for the oassis API: https://oassis.dev/openapi.json",
    inputSchema: fichaDe(mapRequest),
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
      "Follows a site's links and reads every page. Returns a jobId; poll it with web_crawl_status. API key and credits required; `limit` controls the maximum pages charged. Use web_map first if you only need the urls. Reference for the oassis API: https://oassis.dev/openapi.json",
    inputSchema: fichaDe(crawlRequest, { narrow: { formats: FORMATOS_LIGEROS } }),
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
      "Checks a crawl: status, pages read, discovered and still queued, and the pages themselves. Free for the owning account. Pass `cancel: true` to stop it.",
    inputSchema: {
      type: "object",
      properties: {
        jobId: { type: "string", description: "The crawl, from web_crawl." },
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
    inputSchema: fichaDe(searchRequest),
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
    inputSchema: fichaDe(feedbackRequest),
  },
  {
    name: "web_task_start",
    annotations: {
      title: "Start an agent task",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Starts a research task: a question answered by reading public pages, with sources, progress and cost. Requires an API key and credits. The maximum budget is reserved, actual execution cost is charged, and unused credits are released. Returns a task id: check it with web_task_status.",
    inputSchema: fichaDe(taskRequest),
  },
  {
    name: "web_task_status",
    annotations: {
      title: "Check an agent task",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description: "Returns a task's status, progress, sources, limitations, result and billing. Only your own tasks.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The task id, from web_task_start." }, access_token: {type:"string",description:"Task-scoped access token returned by web_task_start; not an API key."} },
      required: ["id"],
    },
  },
  {
    name: "web_task_cancel",
    annotations: {
      title: "Cancel an agent task",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Stops a task using its owning API key, or its legacy access_token. No new operations start. Cancellation is free; unused account credit reservations are released. Cancelling a finished task changes nothing.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The task id, from web_task_start." }, access_token: {type:"string",description:"Task-scoped access token returned by web_task_start; not an API key."} },
      required: ["id"],
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
      properties: { sessionId: { type: "string", description: "The session to close, from web_session_open." } },
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
          protocolVersion: agreedProtocol((params as { protocolVersion?: unknown })?.protocolVersion),
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
            "MCP includes a one-time 100-credit trial for scrape and map. An API key unlocks all tools using your shared balance. Verified accounts receive 1,000 welcome credits.",
            "HTTP operations use x402 (USDC), with no account or API key.",
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
      auth: "optional Bearer API key; required beyond trial and for paid tools",
      /**
       * A demo, not a plan: enough to see whether this is any good, shaped by the first
       * thirty seconds rather than by what is cheap. Anyone who wants more can pay per call
       * with a wallet and no account.
       */
      free: {
        forWho: "MCP clients, with no key and no account",
        allowance: "100 trial credits for scrape and map only; API key and credits for other tools",
        limits: "100 credits per trial identity; scrape and map only",
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

  const key = await requestAccount(c.env.BILLING,c.req.raw.headers);
  if(key === 'invalid')return c.json(toolResult(id,'Invalid or revoked API key. '+CREDIT_GUIDE,true));
  const trialTools = ['web_scrape','web_map','web_feedback'];
  const lifecycle = ['web_batch_status','web_crawl_status','web_session_close','web_task_status','web_task_cancel'];
  if(!key && !trialTools.includes(name) && !lifecycle.includes(name))return c.json(toolResult(id,'api_key_required: '+CREDIT_GUIDE,true));
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

  if (name === "web_task_start" || name === "web_task_status" || name === "web_task_cancel") {
    if (name === "web_task_start") {
      const r=await startTask(c.env,{account:key!.id,body:args,idempotencyKey:typeof args.idempotency_key==='string'?args.idempotency_key:null,baseUrl:c.env.BASE_URL});
      return c.json(toolResult(id,JSON.stringify(r.ok?{...r,task_id:r.taskId,billing:{channel:'credits',pricing:'reserve maximum; charge actual cost; release unused credits'}}:r.error),!r.ok));
    }
    // Legacy task tokens still work for tasks started before the credit rollout.
    const out=key ? (name==='web_task_cancel'?await cancelTask(c.env,key.id,String(args.id||'')):await getTask(c.env,key.id,String(args.id||''))) : await publicTask(c.env,String(args.id||''),String(args.access_token||''),name==='web_task_cancel');
    return c.json(toolResult(id,JSON.stringify("body" in out?out.body:out),out.status>=400));
  }

  /** Reporting a bad answer is free, with or without a key. */
  if (name === "web_feedback") {
    const who = await callerAccount(c);
    if (who === "invalid") return c.json(toolResult(id, "Invalid or revoked key.", true));
    const parsed = feedbackRequest.safeParse(args);
    if (!parsed.success) return c.json(toolResult(id, issuesText(parsed.error.issues), true));
    if ((await storeFeedback(c.env, who, parsed.data, "mcp", true)) === "too_many") {
      return c.json(toolResult(id, "Today's anonymous reports are used up. Send them tomorrow, or with an API key.", true));
    }
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
   * A key is charged to its balance. Without one the call is free over MCP, except search,
   * and `payer` stays null.
   */
  const payer: string | null = key?.id ?? null;
  const trial = !key ? await trialIdentity(c.env,c.req.raw.headers) : null;
  if(!key && !trial)return c.json(toolResult(id,'api_key_required: Trial identity unavailable. '+CREDIT_GUIDE,true));
  const refusal=key ? null : await checkFreeCall({}, {tool:name,url:typeof args.url==='string'?args.url:undefined,urls:Array.isArray(args.urls)?args.urls.filter((u):u is string=>typeof u==='string'):undefined});
  if(refusal)return c.json(toolResult(id,'This site disallows automated access in robots.txt.',true));
  if (route === 'act') {
    const denied=await notYours(c,sessionOf,payer);
    if(denied)return c.json(toolResult(id,denied,true));
  }

  if(key) {
    const left=await charge(c.env.BILLING,key.id,{micros,concept:'MCP credits',route:name});
    if(left===null)return c.json(toolResult(id,JSON.stringify({error:'insufficient_credits',required_credits:creditsFor(micros),available_credits:creditsFor(key.balanceMicros),message:CREDIT_GUIDE}),true));
    c.set('payer',{gate:'key',account:key,identity:key.id,chargedMicros:micros});
  } else if(!await takeTrial(c.env,trial!,micros))return c.json(toolResult(id,'mcp_trial_exhausted: Your 100 trial credits cannot cover this operation. '+CREDIT_GUIDE,true));
  let refunded=0;
  const finish = (text: string, isError = false) => {
    const result=toolResult(id,text,isError);
    return c.json({...result,result:{...result.result,_meta:{'oassis/credits':{charged:creditsFor(micros-refunded),remaining:key?creditsFor(key.balanceMicros-micros+refunded):null,recharge_url:'https://oassis.dev/dashboard/billing'}}}});
  };

  /** Gives back the whole charge, or `parte` of it, when the work did not happen. Keyless calls have nothing to give back. */
  const giveBack = async (reason: string, parte?: number) => {
    const amount=Math.max(0,Math.min(parte ?? micros,micros-refunded));
    if(!amount)return;
    if (payer) await credit(c.env.BILLING, payer, amount, reason);
    else if(trial)await refundTrial(c.env,trial,amount);
    refunded+=amount;
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
      const req = parsed.data;
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

      /**
       * A session that never opened is not a service.
       *
       * The HTTP route closes the row and refunds; this one did neither, so the same
       * failure cost money through one door and nothing through the other. The row
       * matters too: left open it counts towards the caller's limit for ever.
       */
      if (!res.ok) {
        await closeSession(c.env.BILLING, sessionId, () => 0).catch(() => null);
        await giveBack("refund: session did not open");
      }
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
      if(!res.ok)await giveBack("refund: batch did not start");
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
      // Igual que en la puerta http: el sitio que no dio nada se devuelve, pero una
      // lista vacía porque los filtros del que llama la vaciaron es una respuesta
      // completa, y `offered` dice de quién fue el filtro.
      const enVacio = res.urls.length === 0 && res.offered === 0;
      if (enVacio) await giveBack("refund: nothing to map");
      return finish(JSON.stringify(res), enVacio);
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
      if(!res.ok)await giveBack("refund: crawl did not start");
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
  const key=await requestAccount(c.env.BILLING,c.req.raw.headers);
  return key === "invalid" ? "invalid" : key?.id ?? null;
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
