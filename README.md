# oassis — web scraping, crawling and browser control for AI agents

Extract web pages and documents, discover site URLs, crawl sites, control a browser,
and run research through one API and MCP server. Try Scrape and Map with 100 trial
credits, then use an API key with account credits. Paid HTTP operations also support
independent x402 wallet payment without an account.

**[oassis.dev](https://oassis.dev)** · MCP: `https://api.oassis.dev/mcp` ·
[OpenAPI](https://api.oassis.dev/openapi.json) · [llms.txt](https://api.oassis.dev/llms.txt)

---

## Try Scrape and Map without an account

Open **[oassis.dev/try](https://oassis.dev/try)** to test Web Scrape and Web Map in your browser.
No signup or API key is needed for the one-time 100-credit trial. The trial is shared
by callers on the same network. Other paid tools and usage beyond the trial require
an API key and sufficient account credits over MCP.

Discover the current MCP tools:

```bash
curl -X POST https://api.oassis.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'user-agent: MyAgent/1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Map oassis.dev using the MCP trial:

```bash
curl -X POST https://api.oassis.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'user-agent: MyAgent/1.0' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"web_map","arguments":{"url":"https://oassis.dev"}}}'
```

Read a page (`web_scrape`) with the same client:

```bash
curl -X POST https://api.oassis.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'user-agent: MyAgent/1.0' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"web_scrape","arguments":{"url":"https://oassis.dev","formats":["markdown"]}}}'
```

Search, browser sessions, actions and background tasks require an API key with credits
over MCP. HTTP supports account credits or independent x402 payment.

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

The `payment-required` header (base64) quotes the full request. A fresh page with
`markdown` and `controls` costs **4000 micro-USDC = $0.004**, network
`eip155:8453` (Base mainnet), asset USDC `0x8335…2913`, recipient `payTo` `0x23Fc…Dfc75d`.

Step 2: sign the payment with your wallet. Use an x402 SDK for your language: the client signs
an EIP-3009 USDC authorization and the facilitator settles it. The wallet only needs USDC on
Base; the facilitator pays the gas.

Step 3: repeat the **same request** with the payment proof in the `PAYMENT-SIGNATURE` header.
The response comes back with `PAYMENT-RESPONSE`.

MCP includes a one-time 100-credit trial for scrape and map. Other tools and further use require a Bearer API key with account credits. HTTP accepts the same API key or x402.

---

## Web Tools and Web Tasks

The same definitive routes are served on api.oassis.dev, web.oassis.dev and oassis.dev.
Web Tools return individual results; Web Tasks start asynchronous batch, crawl or research jobs.
Account credits are separate: `GET /web/v1/account` requires an API key.

<!-- WEB_CATALOG_START -->
### Web Tools

| MCP tool | HTTP route | What it does |
| --- | --- | --- |
| `web_scrape` | `POST /web/v1/scrape` | Read a page or document in the requested formats. |
| `web_map` | `POST /web/v1/map` | List a site's URLs from its sitemap and optionally the page. |
| `web_search_exa` | `POST /web/v1/search` | Search the web. |
| `web_session_open` | `POST /web/v1/session` | Open a browser session and inspect its controls. |
| `web_act` | `POST /web/v1/act` | Interact with an open browser session. |
| `web_session_close` | `POST /web/v1/session/{id}/close` | Close the browser session and settle any outstanding time. |
| `web_feedback` | `POST /web/v1/feedback` | Report whether a result was correct. Free. |

### Web Tasks

| MCP tool | HTTP route | What it does |
| --- | --- | --- |
| `web_scrape_batch` | `POST /tasks/v1/scrape/batch` | Start a batch extraction job from a supplied list of URLs. |
| `web_batch_status` | `GET /tasks/v1/scrape/batch/{id}` | Read batch status and collect its results. |
| `web_batch_status` | `POST /tasks/v1/scrape/batch/{id}/cancel` | Cancel pending batch work. With MCP, send cancel: true. |
| `web_crawl` | `POST /tasks/v1/crawl` | Start a crawl job that discovers and reads linked pages. |
| `web_crawl_status` | `GET /tasks/v1/crawl/{id}` | Read crawl status and collect its results. |
| `web_crawl_status` | `POST /tasks/v1/crawl/{id}/cancel` | Cancel pending crawl work. With MCP, send cancel: true. |
| `web_task_start` | `POST /tasks/v1/research` | Start research from public pages and return an answer with sources. |
| `web_task_status` | `GET /tasks/v1/research/{id}` | Read research progress, sources, result and billing. |
| `web_task_cancel` | `POST /tasks/v1/research/{id}/cancel` | Cancel pending research work. |
<!-- WEB_CATALOG_END -->

Batch and crawl cancellation reuse their MCP status tool with `cancel: true`; HTTP has
an explicit POST cancellation route. A successful start confirms acceptance, not completion.
MCP and API-key HTTP share credit prices. x402 is an independent payment option for paid
starts. Status and cancellation do not create a new payment; eligible refunds return to
account credits, with no automatic on-chain refund for settled x402 payments.

GET discovery on paid start routes returns a 402 description and quote without execution.
Owner-authorized GET status returns the job status and results. Replace `{id}` with the
identifier returned at creation.

---

## Pricing

| Item | Price |
|---|---|
| Page output: `markdown`, `html`, `links`, `controls`, `elements`, `accessibility`, `screenshot` | **$0.002** each |
| `pdf` output | $0.002 |
| `json` output (model extraction) | $0.005 |
| Output served from cache | $0.0002 |
| Document by URL (PDF, Word, Excel, CSV) | $0.002 |
| Site map (sitemap) | $0.002 |
| Site map including the page | $0.003 |
| Browser session, first minute | $0.005 |
| Each further session minute | $0.004 |
| Each action | $0.0005 |
| Search | What Exa charges, passed through |

Each operation uses its quoted price; requesting multiple outputs adds their prices.
Cache hits, actions and lifecycle operations have separate rates. Purchased credits
do not expire. Credit packs can be bought once or optionally monthly.

Account-key research reserves a maximum budget and settles actual usage. HTTP x402
research purchases a fixed execution budget. Inspect errors and billing metadata: a
failed or partial result does not necessarily mean that no work was performed.

Crawls and batches are charged up front for the pages or urls they may read. A refund for work that never ran is a credit to an API-key account. A wallet payment (x402) is settled on-chain and cannot be reversed from here, so with x402 you pay for every url or the `limit` you ask for: map the site first.

Pricing example: `markdown` + `controls` on a fresh web page = $0.004. A 10-page crawl
with `markdown` costs up to $0.04, because each page charges its outputs plus link discovery.

---

## MCP access and credits

| Item | Rule |
|---|---|
| `web_scrape` and `web_map` without a key | One-time 100-credit trial shared by network identity |
| Other paid tools and continued usage | Bearer API key and sufficient shared account credits |
| Discovery, status and cancellation | Free; lifecycle requests still require ownership |
| `web_feedback` | Free, subject to reporting limits |
| Browser session close | No closing fee; outstanding browser time may be settled |
| `robots.txt` | Respected on keyless trial reads |

One credit equals $0.002. Verified accounts receive 1,000 welcome credits once.
Buy 2,500 credits for $5, 10,000 for $20 or 25,000 for $50. Purchased credits do not
expire. The same Bearer key and balance work over MCP and HTTP.

---

## MCP

Streamable HTTP at `https://api.oassis.dev/mcp`. Published in the
[official MCP registry](https://registry.modelcontextprotocol.io) as `dev.oassis/scraper-crawler`,
and under the organization [github.com/oassisdev](https://github.com/oassisdev).

`initialize` and `tools/list` are always free.

---

## Web Tasks: research

Ask a question in plain words and get a structured answer with its sources. The agent plans
its own steps: it decides what to search, which pages to read, and when it has enough.

Tasks require an API key with credits over MCP/HTTP, reserving a maximum and charging actual execution cost. x402 can independently pay a fixed task package.

```bash
curl -X POST https://api.oassis.dev/tasks/v1/research \
  -H 'authorization: Bearer oas_…' \
  -H 'content-type: application/json' \
  -H 'idempotency-key: compare-hosts-1' \
  -d '{"task":"Compare pricing and limits of three hosting providers for AI agents",
       "mode":"research","urls":[],
       "limits":{"max_cost_usd":0.10,"max_duration_seconds":180,"max_steps":10}}'
```

The answer is `202 Accepted` with a `Location` header. Read it until it is final:

```bash
curl https://api.oassis.dev/tasks/v1/research/TASK_ID -H 'authorization: Bearer oas_…'
```

Statuses: `queued`, `running`, `completed`, `partial`, `failed`, `cancelled`. A task is
`completed` only when it has findings that cite pages it really read, nothing is left open and
no limit was hit. Otherwise it is `partial`, with the reason and what is missing. A task with no
page read at all is `failed`.

Cancel with `POST /tasks/v1/research/TASK_ID/cancel`. Cancelling a finished task changes nothing.

**Budget.** `max_cost_usd` is reserved from the balance before the task starts. What the task
spends is charged at the end, and the rest of the reserve is returned in the same transaction.
A request that would exceed the balance is refused with `402` and nothing is reserved.

**Prices.** Research charges for the steps it attempts. The start fee is charged once
when a task is accepted:

| Step | Charged |
| --- | --- |
| Start fee (task accepted) | $0.002 |
| Planning call, each attempt | $0.006 |
| Final answer, each attempt | $0.010 |
| Page read, each attempt (markdown) | $0.003 |
| Search | twice what Exa charged us, every time, including empty or uncertain results |
| Get a task, cancel a task | free |

Every attempted model call and page read is charged, including the ones that fail: the model or the
browser ran. A call that is refused before it runs (budget exhausted) is not attempted and not charged.
Each model call is capped (planning at 256 output tokens, the answer at 1,500) and must return within
30 seconds for planning and 60 seconds for the answer; a call that runs past its limit counts as attempted, and is charged.

The minimum budget is $0.03: it pays the start fee, one planning call, one page read and one answer.

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
no obvious local or private hosts or addresses, and no IPv6 literals. This is a filter, not a full protection against
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

## Account credits

1 basic single-format page = 1 credit = $0.002. Buy 2,500 / 10,000 / 25,000 credits for $5 / $20 / $50, once or optionally monthly. Purchased credits accumulate without scheduled expiry. MCP and HTTP use the same `Authorization: Bearer oas_…` key and balance. Other operations consume their quoted dollar price divided by $0.002; fractions are supported.

Generate or revoke keys at https://oassis.dev/dashboard/billing. Verified accounts receive 1,000 welcome credits once. MCP without a key has a lifetime 100-credit scrape/map trial, associated with a salted Cloudflare IP hash (shared networks share the trial). When exhausted, the tool requests signup and an API key. Status/cancellation and discovery are free.

See [billing operations](docs/prepaid-billing.md) for migrations, Stripe activation and alert delivery.

## Definitive API families

The same paths are used on every API host. There are no old-path aliases or redirects.

- Web Tools: `/web/v1/scrape`, `/map`, `/search`, `/session`, `/act`, `/feedback`. Session close: `POST /web/v1/session/:id/close`.
- Web Tasks — extraction: `POST /tasks/v1/scrape/batch` and `POST /tasks/v1/crawl`; status: `GET` on the creation path plus `/:id`; cancellation: `POST` on that status path plus `/cancel`.
- Web Tasks — research: `POST /tasks/v1/research`; `GET /tasks/v1/research/{id}`; `POST /tasks/v1/research/{id}/cancel`.
- Agent catalog: `GET /agents/v1` and `GET /agents/v1/:agent`. Create a service: `POST /agents/v1/:agent`.
- Owned services: `GET /agents/v1/services` (latest 100), `GET /agents/v1/services/:id`, `POST /agents/v1/services/:id/cancel`. Cancellation is idempotent, retains the report and stops future runs. A read already in progress may finish.

Clients must replace `/v1/*`, `/web/v1/crawl*`, `/web/v1/scrape/batch*` and `/agent/v1/tasks*`. These old URLs are no longer mounted and return 404. Existing job/service identifiers remain valid on the definitive paths. API keys, MCP tool names and billing rules do not change.
