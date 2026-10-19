import { WEB_CATALOG, WEB_FAMILIES } from "./product-catalog";
/**
 * The machine-readable catalogue: `/openapi.json` and `/llms.txt`.
 *
 * Routes, prices and descriptions follow the runtime catalogue. Request schemas come
 * from the execution validators, including nested options and bounds. llms.txt lists
 * the same operations by product family, including free lifecycle endpoints.
 * Payment challenges, accepted work and settled wallet payments are distinct states.
 */

import { fichaDe } from "./mcp-schema";
import { feedbackRequest } from "./feedback";
import { productPath } from "./api-routes";
import { CREDIT_GUIDE, CREDIT_MICROS, MCP_TRIAL_CREDITS, WELCOME_CREDITS, CREDIT_PACKAGES } from "./billing/credits";
import { scrapeRequest, sessionRequest, actRequest, batchRequest, mapRequest, crawlRequest, searchRequest, LIGHT_FORMATS } from "./schema";
import { taskRequest } from "./agent/request";
import { agentServicePaths } from "./agents/openapi";
import type { Context } from "hono";
import { actDoc, batchDoc, crawlDoc, doc, mapDoc, searchDoc, sessionDoc } from "./docs";
import { origin } from "./http";
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

/** Publish the same bounds and nested fields that validate execution requests. */
function requestSchema(path: typeof PAID[number]['path']) {
  const schema = { scrape: scrapeRequest, session: sessionRequest, act: actRequest, 'scrape/batch': batchRequest, map: mapRequest, crawl: crawlRequest, search: searchRequest }[path];
  const options = path === 'session' ? { omit: ['html'], required: ['url'] }
    : path === 'act' ? { omit: ['html'], extra: fichaDe(sessionRequest, { omit: ['html','url'] }).properties }
    : path === 'crawl' || path === 'scrape/batch' ? { narrow: { formats: { type: 'array', items: { type: 'string', enum: [...LIGHT_FORMATS] }, default: ['markdown'] } } } : {};
  return { ...fichaDe(schema, options),
    ...(path === 'scrape' ? { oneOf: [{ required: ['url'], not: { required: ['html'] } }, { required: ['html'], not: { required: ['url'] } }] } : {}),
  };
}

/** The OpenAPI document, built for whoever is asking: the host decides the paths. */
/** Research Tasks support shared account credits or a fixed x402 budget. */
function agentTaskPaths(): Record<string, unknown> {
  const bearer = [{ apiKey: [] },{ taskToken: [] }];
  const unauthorized = { "401": { description: "Missing or invalid owner API key or task-scoped access token." } };
  const notFound = { "404": { description: "Task not found or task token does not match." } };
  return {
    ["/tasks/v1/research"]: {
      get: { tags: ['Discovery'], summary: 'Describe Research Tasks and quote the execution budget', responses: { '402': { description: 'Description and x402 challenge only; nothing is executed or paid.' }, '503': { description: 'Wallet payment unavailable.' } } },
      post: {
        tags:["Web Tasks"], "x-task-type":"research",
        summary: "Start a research task",
        description:
          "Answers a question by reading public pages, with sources, progress and cost. With an API key, HTTP reserves credits and settles actual cost. Without a key, x402 pays a fixed execution budget in limits.max_cost_usd. MCP start requires an API key and reserves credits, settling actual cost. With an API key, use the owning key for free status/cancel and send Idempotency-Key (required, maximum 100 characters). The x402 response returns access_token: send it as Task-Token for status/cancel. For x402 retries send the same Task-Token and Idempotency-Key (maximum 200 characters). A 202 confirms acceptance, not a completed result.",
        operationId: "web_task_start",
        security: [{apiKey:[]},{}],
        "x-x402": { protocol:"x402", pricing:"fixed execution budget", defaultPrice:"$0.10",price:"limits.max_cost_usd (default $0.10)" },
        parameters: [
          { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 }, description: "Required for API-key starts (1-100 characters). Optional for x402 starts (1-200 characters); reuse it with the same Task-Token and body to retry. Conflicting payloads return 409." },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { ...fichaDe(taskRequest), additionalProperties: false },
            },
          },
        },
        responses: {
          "202": { description: "Accepted, not completed. Location points at the task. Body includes task_id, status and location; x402 also returns access_token. Poll status until a terminal outcome." },
          "400": { description: "The request does not match the contract. Unknown fields and unsupported modes are refused." },
          "402": { description: "Insufficient account credits, or x402 payment required without an API key." },
          "409": { description: "The Idempotency-Key was used with a different request." },
          ...unauthorized,
        },
        "x-mcp-tool": "web_task_start",
      },
    },
    ["/tasks/v1/research/{id}"]: {
      get: {
        tags:["Web Tasks"], "x-task-type":"research",
        summary: "Read a task",
        description:
          "Status, progress, operations, sources with the evidence used, limitations, the result when there is one, and billing: reserved, spent, released and settlement.",
        operationId: "web_task_status",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "The task." }, ...notFound, ...unauthorized },
        "x-mcp-tool": "web_task_status",
      },
    },
    ["/tasks/v1/research/{id}/cancel"]: {
      post: {
        tags:["Web Tasks"], "x-task-type":"research",
        summary: "Cancel a task",
        description:
          "Stops new operations and returns the unused budget. An operation already running cannot always be stopped remotely: it is charged as it completes. Cancelling a finished task changes nothing.",
        operationId: "web_task_cancel",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "202": { description: "Cancellation requested. The body is the task as it stands." },
          "200": { description: "The task had already finished: nothing changed. The body is the task." },
          ...notFound,
          ...unauthorized,
        },
        "x-mcp-tool": "web_task_cancel",
      },
    },
  };
}

export function openapi(c: Context<{ Bindings: Env }>): Record<string, unknown> {
  const base = origin(c);
  const payTo = c.env.X402_PAY_TO;
  const network = (c.env.X402_NETWORK ?? "base") === "base" ? "eip155:8453" : "eip155:84532";

  const paths: Record<string, unknown> = { ...agentTaskPaths(), ...agentServicePaths() };
  for (const { path, build, tool, summary, from } of PAID) {
    const described = build(c) as Doc;
    /** Some routes document a family of paths rather than one, and carry no single line. */
    const about = described.description ?? Object.values(described.endpoints ?? {})[0] ?? summary;
    const full = productPath(path);
    paths[full] = {
      get: {
        summary: `What ${full} expects`,
        description: "Discovery only: no execution and no charge. Without payment credentials the endpoint returns HTTP 402 with its description and a PAYMENT-REQUIRED challenge. Use /openapi.json or /llms.txt for HTTP 200 documentation.",
        tags: ["Discovery"],
        responses: { "402": { description: "Endpoint description and payment challenge; reading the challenge does not pay or execute the operation." } },
      },
      post: {
        summary,
        tags:[full.startsWith("/tasks/")?"Web Tasks":"Web Tools"],
        description: about + (full.startsWith("/tasks/") ? " Returns a jobId for asynchronous work. A successful start is acceptance, not completion; poll the job status. Account credits can be refunded for unused work; x402 has no automatic on-chain refund." : " HTTP supports the same Bearer API key and shared credits as MCP, or an independent x402 wallet payment."),
        operationId: tool,
        security: [{apiKey:[]},{}],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: requestSchema(path),
              ...(described.example ? { example: described.example } : {}),
            },
          },
        },
        responses: {
          "200": { description: Object.entries(described.response ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "The result." },
          "400": { description: "Invalid request; nothing is executed." },
          "401": { description: "Invalid or revoked API key." },
          "402": { description: "Insufficient account credits, or x402 payment required. The wallet challenge travels in PAYMENT-REQUIRED; a 402 is not a payment or an execution." },
          "503": { description: "Operation temporarily unavailable." },
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
          note: "POST a valid request unpaid to receive its exact quote. After a successful wallet settlement, PAYMENT-RESPONSE contains the facilitator receipt and transaction hash. A quote is not a payment.",
        },
        "x-mcp-tool": tool,
      },
    };
  }

  paths['/web/v1/session/{id}/close']={post:{tags:['Web Tools'],operationId:'web_session_close',summary:'Close a browser session',description:'Stops the browser. Outstanding browser time is settled; there is no additional close fee.',security:[{apiKey:[]},{walletPayment:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}],responses:{'200':{description:'Session closed.'},'401':{description:'Invalid API key.'},'404':{description:'Session not found or owned by another caller.'}}}};
  paths['/web/v1/feedback']={post:{tags:['Web Tools'],operationId:'web_feedback',summary:'Report a result',description:'Free; an API key is optional.',requestBody:{required:true,content:{'application/json':{schema:fichaDe(feedbackRequest)}}},responses:{'200':{description:'Feedback recorded.'},'400':{description:'Invalid feedback.'},'401':{description:'Invalid API key.'},'429':{description:'Reporting limit reached.'}}}};
  paths['/web/v1/account']={get:{tags:['Account'],operationId:'account_credits',summary:'Read available and reserved account credits',security:[{apiKey:[]}],responses:{'200':{description:'Account and credit balance.'},'401':{description:'API key required.'}}}};

  for(const [name,tool] of [['scrape/batch','web_batch_status'],['crawl','web_crawl_status']] as const){
   const path='/tasks/v1/'+name+'/{id}';
   const shared={tags:['Web Tasks'],security:[{apiKey:[]},{walletPayment:[]}],parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}]};
   paths[path]={get:{...shared,operationId:tool,summary:'Read '+name+' status and results',parameters:[...shared.parameters,{name:'limit',in:'query',required:false,schema:{type:'integer',minimum:1,maximum:50,default:50}}],description:'Free for the owner. Authenticate with the same account key or the wallet credentials used to create the job.',responses:{'200':{description:'Job status and results.'},'401':{description:'Invalid API key.'},'404':{description:'Job not found or owned by another caller.'}}}};
   paths[path+'/cancel']={post:{...shared,operationId:tool+'_cancel',summary:'Cancel '+name,description:'Stops pending work. With account credits, unused and failed reads are refunded; an in-flight page may finish and is billed normally. Settled x402 payments have no automatic on-chain refund. The result remains available to the owner.',responses:{'200':{description:'Job cancellation result.'},'401':{description:'Invalid API key.'},'404':{description:'Job not found or owned by another caller.'}}}};
  }

  paths['/mcp'] = {
    get: { tags: ['Discovery'], operationId: 'describe_mcp', summary: 'Describe MCP access, credits and tool families', responses: { '200': { description: 'MCP discovery document. No tool is executed.' } } },
    post: { tags: ['Discovery'], operationId: 'mcp_jsonrpc', summary: 'MCP JSON-RPC transport', description: 'Use initialize, tools/list and tools/call. Bearer API key is optional for discovery and the scrape/map trial; required for other paid tools. Tool errors may be represented by JSON-RPC errors or result.isError in an HTTP 200 response.', security: [{apiKey:[]},{}], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['jsonrpc','method'], properties: { jsonrpc: {type:'string',enum:['2.0']}, id: {type:['string','number','null']}, method: {type:'string'}, params: {type:'object'} } } } } }, responses: { '200': { description: 'JSON-RPC response; inspect error and result.isError, not only HTTP status.' }, '202': { description: 'Notification accepted without a response body.' } } },
  };
  for (const path of ['/openapi.json','/llms.txt']) paths[path] = { get: { tags: ['Discovery'], summary: 'Read the public ' + path.slice(1) + ' catalog', responses: { '200': { description: 'Public documentation; no charge.' } } } };

  for (const op of WEB_CATALOG) {
    const methods = paths[op.path] as Record<string, Record<string, unknown>> | undefined;
    const definition = methods?.[op.method.toLowerCase()];
    if (!definition) throw new Error('OpenAPI catalog mismatch: ' + op.id);
    definition.tags = [WEB_FAMILIES.find(f => f.id === op.family)!.name];
    definition['x-mcp-tool'] = op.mcp;
    if (op.mcpArguments) definition['x-mcp-arguments'] = op.mcpArguments;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "oassis — web scraping, crawling and browser control for AI agents",
      version: VERSION,
      description:
        "Scrape any page or document to markdown, map and crawl whole sites, drive a real browser, " +
        "and search the web. " +
        "Pay per call with a wallet and no account at all (x402, USDC on Base). MCP includes a 100-credit trial; further use requires an API key and credits. " +
        "Web Tools use /web/v1; Web Tasks (asynchronous extraction and research) use /tasks/v1; scheduled monitoring services use /agents/v1. A 402 is a quote, not a payment. " + CREDIT_GUIDE,
      "x-mcp": `${base}/mcp`,
      "x-logo": { url: `${origin(c)}/icon-512.png`, altText: "oassis" },
    },
    servers: [{ url: base }],
    "x-product-catalog": WEB_CATALOG,
    tags: [
      ...WEB_FAMILIES.map(f => ({ name: f.name, description: f.id === 'web' ? 'Individual operations: /web/v1.' : 'Asynchronous batch extraction, crawling and research: /tasks/v1. Separate start, status and cancellation operations.' })),
      { name: 'Agents', description: 'Scheduled monitoring services: /agents/v1. Currently free with an API key; not MCP tools.' },
      { name: 'Account', description: 'Shared API-key credits.' },
      { name: 'Discovery', description: 'Descriptions and challenges; these do not execute tools.' },
    ],
    'x-credits': { unitUsd: CREDIT_MICROS / 1e6, mcpTrialCredits: MCP_TRIAL_CREDITS, mcpTrialTools: ['web_scrape','web_map'], welcomeCredits: WELCOME_CREDITS, packages: CREDIT_PACKAGES.map(p => ({ usd: p.cents / 100, credits: p.credits })), billingUrl: SITE + '/dashboard/billing' },
    components: { securitySchemes: { walletPayment: { type: "apiKey", in: "header", name: "PAYMENT-SIGNATURE", description: "x402 signed payment for starts and paid web operations; wallet ownership credentials for free job/session lifecycle calls. PAYMENT-REQUIRED is a quote and PAYMENT-RESPONSE is the settlement receipt. API-key users do not need this header." }, apiKey: {type:"http",scheme:"bearer",description:"Oassis API key. Shared account credits; 1 credit = $0.002."}, taskToken: { type: "apiKey", in:"header", name:"Task-Token", description: "Task-scoped access_token, not a customer API key. Status/cancel only." } } },
    /** Where a person goes. The rest of this document is for whatever is reading it. */
    externalDocs: { description: "oassis", url: SITE },
    paths,
    "x-payment": {
      protocol: "x402",
      version: 2,
      network,
      asset: USDC_BASE,
      ...(payTo ? { payTo } : {}),
      note: "Independent wallet payment for paid Web Tools and Task starts; no account required. API-key credits are also supported. Scheduled Agents require an account key and currently do not debit credits. Discovery, status and cancellation are not new wallet payments.",
    },
  };
}

/** The same catalogue as plain text, for whoever reads with a model instead of a parser. */
export function llmsTxt(c: Context<{ Bindings: Env }>): string {
  const spec = openapi(c) as { info: { description: string }; paths: Record<string, Record<string, { summary?: string; description?: string; 'x-x402'?: { price?: string }; 'x-mcp-tool'?: string }>> };
  const base = origin(c);
  const lines = ['# oassis', '', '> Web infrastructure for AI agents: Web Tools, Web Tasks and scheduled Agents.', '',
    '## Access and credits', '', CREDIT_GUIDE, '',
    '- **MCP:** 100 trial credits for scrape/map, once per trial identity. No account or key is needed for that trial. Other paid tools and further use require an API key and available credits.',
    '- **HTTP with an API key:** send Authorization: Bearer oas_... and use the same account credits as MCP.',
    '- **HTTP with x402:** paid Web Tools and Task starts accept USDC wallet payment without an account. An unpaid valid POST returns HTTP 402 and PAYMENT-REQUIRED. Pay and repeat the request; PAYMENT-RESPONSE carries the settlement receipt.',
    '- **Refunds:** eligible unused work is returned to account credits. Settled x402 payments cannot be automatically refunded on-chain. Research over x402 buys a fixed execution budget; account-key Research reserves a maximum and charges actual cost.',
    '- **Discovery and lifecycle:** reading documentation or a challenge, checking status and requesting cancellation do not create a new payment. Closing a browser session can settle outstanding browser time on the account.',
    '- **Credit packages:** the billing dashboard shows checkout availability for one-time or monthly packages. Create and verify an account before generating a key.',
    '', '## Route structure', '',
    '- /web/v1: synchronous Web Tools, sessions and feedback.',
    '- /tasks/v1/scrape/batch and /tasks/v1/crawl: asynchronous extraction jobs. Starts return jobId; poll the corresponding GET /{id}. POST /{id}/cancel stops pending work.',
    '- /tasks/v1/research: one-shot research with sources. A 202 means accepted, not completed. Check status until completed, partial, failed or cancelled.',
    '- /agents/v1: recurring monitoring services. Currently free with an account API key, up to 10 active services per account; daily or weekly. No MCP tools.',
    '- Use only the definitive routes below. Older /v1, /agent/v1 and extraction under /web/v1 are not aliases.', ''];
  const groups = [
    ['Web Tools', (path: string) => path.startsWith('/web/v1') && path !== '/web/v1/account'],
    ['Web Tasks', (path: string) => path.startsWith('/tasks/v1')],
    ['Scheduled Agents', (path: string) => path.startsWith('/agents/v1')],
    ['Account', (path: string) => path === '/web/v1/account'],
  ] as const;
  for (const [title, includes] of groups) {
    lines.push('## ' + title, '');
    for (const [path, operations] of Object.entries(spec.paths)) {
      if (!includes(path)) continue;
      for (const [method, op] of Object.entries(operations)) {
        lines.push('### ' + method.toUpperCase() + ' ' + path, '', op.description || op.summary || '', '');
        if (op['x-x402']) lines.push('- Price: ' + (op['x-x402'].price || 'Execution budget quoted in PAYMENT-REQUIRED.'));
        if (op['x-mcp-tool']) lines.push('- MCP tool: `' + op['x-mcp-tool'] + '`');
        lines.push('');
      }
    }
  }
  lines.push('## Ownership and retries', '',
    '- Extraction jobs and browser sessions: use the owning account key or the wallet credentials used at creation. Status and cancellation do not buy a new execution.',
    '- Research with an API key: Idempotency-Key is required for HTTP start (maximum 100 characters); use the owning key for status and cancellation.',
    '- Research with x402: retain access_token from the start response and send it as Task-Token on status/cancel. For retries use the same Task-Token, Idempotency-Key and request. Do not send literal {id} or {task_id}: replace it with the returned identifier.',
    '- Research may return a partial result when available evidence or execution limits prevent a complete answer. A successful start is not proof of completion.', '',
    '## MCP', '',
    'Stateless JSON-RPC on POST ' + base + '/mcp. Use initialize, tools/list, then tools/call. GET /mcp describes access and the tool catalog; it does not execute a tool.',
    'Resources: oassis://llms.txt and oassis://openapi.json. Resource and prompt reads are discovery, not Web Tool executions.', '',
    '## Links', '', '- Site: ' + SITE, '- Sign up: ' + SITE + '/signup', '- API keys and credits: ' + SITE + '/dashboard/billing', '- OpenAPI: ' + base + '/openapi.json', '- This file: ' + base + '/llms.txt', '');
  return lines.join('\n');
}
