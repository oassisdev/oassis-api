# oassis — web scraping, crawling and browser control for AI agents

Turn any web page or document into markdown, map and crawl whole sites, and drive a **real
browser**. Pay per call with a wallet: **no API key, no signup, no monthly plan.**

**[oassis.dev](https://oassis.dev)** · MCP: `https://api.oassis.dev/mcp` ·
[OpenAPI](https://api.oassis.dev/openapi.json) · [llms.txt](https://api.oassis.dev/llms.txt)

---

## Try it now, no account (MCP)

Over MCP every tool works without a key or an account, except `web_search_exa`, which is paid.
Send your own client `User-Agent`: requests carrying the default of `curl` or an HTTP library are refused.

List the 11 tools:

```bash
curl -X POST https://api.oassis.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'user-agent: MyAgent/1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Map oassis.dev (free over MCP):

```bash
curl -X POST https://api.oassis.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'user-agent: MyAgent/1.0' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_map","arguments":{"url":"https://oassis.dev"}}}'
```

Real response (trimmed):

```
{"urls":["https://oassis.dev/","https://oassis.dev/web/v1/scrape","https://oassis.dev/llms.txt",
"https://oassis.dev/openapi.json","https://oassis.dev/privacy","https://oassis.dev/terms",
"https://oassis.dev/support"],"discovered":7,"offered":14,"sources":{"sitemap":7,"page":0}}

```

Read a page (`web_scrape`) with the same client:

```bash
curl -X POST https://api.oassis.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'user-agent: MyAgent/1.0' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"web_scrape","arguments":{"url":"https://oassis.dev","formats":["markdown"]}}}'
```

Search is the one paid tool over MCP. Calling it without a key explains the price and how to pay:

```
web_search_exa is paid, not free: each search costs $0.007, which is the price Exa charges, passed through.
Two ways to carry on: pay per call with a wallet (x402, USDC on Base), or use an API key.
```

---

## Pay per call (x402)

Without payment, the request answers **402** with the exact price of that call. Nothing is
charged without a payment.

Step 1: ask for the page. Real response for `oassis.dev` with `markdown` and `controls`:

```bash
curl -i -X POST https://api.oassis.dev/web/v1/scrape \
  -H 'content-type: application/json' \
  -d '{"url":"https://oassis.dev","formats":["markdown","controls"]}'
```

```
HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIi…
```

The `payment-required` header (base64) states: **2000 micro-USDC = $0.002**, network
`eip155:8453` (Base mainnet), asset USDC `0x8335…2913`, recipient `payTo` `0x23Fc…Dfc75d`.

Step 2: sign the payment with your wallet. Use an x402 SDK for your language: the client signs
an EIP-3009 USDC authorization and the facilitator settles it. The wallet only needs USDC on
Base; the facilitator pays the gas.

Step 3: repeat the **same request** with the payment proof in the `PAYMENT-SIGNATURE` header.
The response comes back with `PAYMENT-RESPONSE`.

Over MCP there is no payment step: every tool except `web_search_exa` is free. Search is paid over HTTP, with x402 or an API key.

---

## The 11 operations

Over HTTP each one is paid. Each one is served at `api.oassis.dev/web/v1/…` and at `web.oassis.dev/v1/…`. Both hosts count and charge the same.

| Method | Path | What it does | MCP tool | Price |
|---|---|---|---|---|
| POST | `/web/v1/scrape` | Reads a page or document in the formats you ask for: `markdown`, `html`, `links`, `controls`, `accessibility`, `elements`, `screenshot`, `pdf`, `json` | `web_scrape` | Per output (see pricing) |
| POST | `/web/v1/session` | Opens a browser on a URL and returns its controls, each with a `ref` | `web_session_open` | $0.005 for the first minute + outputs |
| POST | `/web/v1/act` | Click, type, select, wait, scroll on an open session | `web_act` | $0.0005 per action + outputs |
| DELETE | `/web/v1/session/:id` | Closes a session | `web_session_close` | Free (time used is billed) |
| POST | `/web/v1/scrape/batch` | Reads a list of URLs as a background job | `web_scrape_batch` | One scrape per URL |
| GET | `/web/v1/scrape/batch/:id` | Status and results of a batch | `web_batch_status` | Free |
| POST | `/web/v1/map` | Lists a site's URLs from its sitemap (optionally with the page) | `web_map` | $0.001 (no page) · $0.0015 (with page) |
| POST | `/web/v1/crawl` | Follows a site's links and reads each page, as a job | `web_crawl` | Per page read, charged up front |
| GET | `/web/v1/crawl/:id` | Status and results of a crawl | `web_crawl_status` | Free |
| POST | `/web/v1/search` | Web search with Exa's index | `web_search_exa` | What Exa charges (≈ $0.007) |
| POST | `/web/v1/feedback` | Report a result that was wrong | `web_feedback` | Free |

Over MCP, every tool in this table is free except `web_search_exa`. Any `GET` on a route returns, for free, the fields it expects and what it costs.

---

## Pricing

| Item | Price |
|---|---|
| Page output: `markdown`, `html`, `links`, `controls`, `elements`, `accessibility`, `screenshot` | **$0.001** each |
| `pdf` output | $0.002 |
| `json` output (model extraction) | $0.005 |
| Output served from cache | $0.0002 |
| Document by URL (PDF, Word, Excel, CSV) | $0.002 |
| Site map (sitemap) | $0.001 |
| Site map including the page | $0.0015 |
| Browser session, first minute | $0.005 |
| Each further session minute | $0.004 |
| Each action | $0.0005 |
| Search | What Exa charges, passed through |

Minimum charge per call: $0.001. The price is quoted before the work and charged after;
**if the work does not happen, you are not charged.** Balances do not expire and there is no monthly fee.

Crawls and batches are charged up front for the pages or urls they may read. A refund for work that never ran is a credit to an API-key account. A wallet payment (x402) is settled on-chain and cannot be reversed from here, so with x402 you pay for every url or the `limit` you ask for: map the site first.

Example: `markdown` + `controls` of one page = $0.002. A 10-page crawl with `markdown` = $0.02, because each page charges its outputs plus its links.

---

## Free over MCP

| Item | Rule |
|---|---|
| Every tool except `web_search_exa` | Free, no key, no account |
| `web_search_exa` | Paid: Exa's price, passed through |
| Client identification | Send your own `User-Agent`; HTTP-library defaults are refused |
| `robots.txt` | Respected on free reads |
| Browser sessions | 3 open at once across all keyless callers |

Paying per call over HTTP (x402) or with an API key reads the same content on your own responsibility, with no MCP restrictions.

---

## MCP

Streamable HTTP at `https://api.oassis.dev/mcp`. Published in the
[official MCP registry](https://registry.modelcontextprotocol.io) as `dev.oassis/scraper-crawler`,
and under the organization [github.com/oassisdev](https://github.com/oassisdev).

`initialize` and `tools/list` are always free.

---

## Agent tasks

Ask a question in plain words and get a structured answer with its sources. The agent plans
its own steps: it decides what to search, which pages to read, and when it has enough.

Tasks need an API key with a balance. They are not free, even where the single tools are.

```bash
curl -X POST https://api.oassis.dev/agent/v1/tasks \
  -H 'authorization: Bearer oas_…' \
  -H 'content-type: application/json' \
  -H 'idempotency-key: compare-hosts-1' \
  -d '{"task":"Compare pricing and limits of three hosting providers for AI agents",
       "mode":"research","urls":[],
       "limits":{"max_cost_usd":0.10,"max_duration_seconds":180,"max_steps":10}}'
```

The answer is `202 Accepted` with a `Location` header. Read it until it is final:

```bash
curl https://api.oassis.dev/agent/v1/tasks/TASK_ID -H 'authorization: Bearer oas_…'
```

Statuses: `queued`, `running`, `completed`, `partial`, `failed`, `cancelled`. A task is
`completed` only when it has findings that cite pages it really read, nothing is left open and
no limit was hit. Otherwise it is `partial`, with the reason and what is missing. A task with no
page read at all is `failed`.

Cancel with `POST /agent/v1/tasks/TASK_ID/cancel`. Cancelling a finished task changes nothing.

**Budget.** `max_cost_usd` is reserved from the balance before the task starts. What the task
spends is charged at the end, and the rest of the reserve is returned in the same transaction.
A request that would exceed the balance is refused with `402` and nothing is reserved.

**Prices.** Each client price is at least twice what the work costs us:

| Step | Charged |
| --- | --- |
| Planning call (model) | $0.003 |
| Final answer (model) | $0.008 |
| Page read (markdown) | $0.001 |
| Search | twice what Exa charged us, every time, including empty or uncertain results |

A planning call or an answer that does not come back in a usable form is not charged. A page that
cannot be read is not charged either.

**Idempotency.** `Idempotency-Key` is per account. The same key with the same request returns the
same task. The same key with a different request is refused with `409`. Keys are kept with their
task. MCP has no idempotency key: retry tasks over HTTP.

**Uncertain operations.** A payment to Exa that may have gone through, but whose outcome is unknown
(for example after a crash), is charged at the most it could have cost. It is never retried, and the
task ends as `partial`, or `failed` when no page had been read, and says so.

**Sources and evidence.** Each source has an id, the URL, the time it was read, and the fragment of
the page the answer may use. A page is cut at 4,000 characters and the cut is marked. The model
sees at most 12,000 characters of evidence in one call. Page content is treated as data: it cannot
change the task, call tools or authorise spending. A finding that cites a source the task did not
read is removed. The task reports how many were removed as `findings_removed`. The server checks the citations, not the wording: a finding can cite a real page and still add a conclusion the page does not state. Read the cited evidence before you rely on a finding.

**MCP.** `web_task_start`, `web_task_status` and `web_task_cancel` run the same code as the HTTP
endpoints.

**Limits of version 1.** Tasks research public pages only. They do not submit forms, buy, book or
send anything. Crawls, browser sessions and actions are not part of tasks yet.

**Network safety.** Urls are checked before they are read: only `http` and `https`, no credentials,
and no obvious local or private hosts or addresses. This is a filter, not a full protection against
server-side request forgery: a public name can resolve to a private address, and redirects are
followed. Do not rely on it to keep an agent away from your internal network.

**Model.** Planning and answers run on Workers AI. The default model is
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`; set `AGENT_MODEL` to change it. The rates live in
`src/agent/rates.ts`.

## Run your own copy

```bash
npm install
npm run check      # typecheck, dead-export scan, tests
npm run deploy     # Cloudflare Workers
```

Needs a D1 database, a KV namespace and the Browser Run binding; see `wrangler.jsonc`.
Payments need `X402_PAY_TO` and, to settle on Base mainnet, CDP keys.

## License

[Elastic License 2.0](LICENSE). You may read, run, modify and host it for yourself; you may
not offer it to third parties as a hosted or managed service.
