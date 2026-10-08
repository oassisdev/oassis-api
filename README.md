# oassis — web scraping, crawling and browser control for AI agents

Turn any web page or document into markdown, map and crawl whole sites, and drive a **real
browser**. Pay per call with a wallet: **no API key, no signup, no monthly plan.**

**[oassis.dev](https://oassis.dev)** · MCP: `https://api.oassis.dev/mcp` ·
[OpenAPI](https://api.oassis.dev/openapi.json) · [llms.txt](https://api.oassis.dev/llms.txt)

---

## Try it now, no account (MCP)

The free tier is for MCP clients. Send your own client `User-Agent`: requests carrying the
default of `curl` or an HTTP library are refused.

List the 11 tools:

```bash
curl -X POST https://api.oassis.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'user-agent: MyAgent/1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Map oassis.dev (free tier: 10 site maps a day per client):

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

(Free tier left: 0 reads and 8 site listings today, 1 session and 5 searches ever.
A key or a wallet payment removes the limits.)
```

Read a page (`web_scrape`) with the same client:

```bash
curl -X POST https://api.oassis.dev/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'user-agent: MyAgent/1.0' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"web_scrape","arguments":{"url":"https://oassis.dev","formats":["markdown"]}}}'
```

Once the 10 daily reads are used up, the response says so and offers the paid route:

```
10 free reads a day, and today's are used. They come back tomorrow.
Two ways to carry on: pay per call with a wallet (x402, USDC on Base), or use an API key.
```

Free allowances are counted per IP address and per UTC day.

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

Over MCP, the same charge applies when a call is outside the free tier: the server answers with
the payment challenge and the same SDK pays it.

---

## The 11 operations

Each one is served at `api.oassis.dev/web/v1/…` and at `web.oassis.dev/v1/…`. Both hosts count and charge the same.

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

Any `GET` on a route returns, for free, the fields it expects and what it costs.

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

Example: `markdown` + `controls` of one page = $0.002. A 10-page crawl with `markdown` = $0.02, because each page charges its outputs plus its links.

---

## Free tier over MCP

| Item | Limit |
|---|---|
| `web_scrape` (page reads) | 10 per day |
| `web_map` (site listings) | 10 per day |
| Pages of the same site per day | 3 |
| Browser session | 1, ever |
| Actions in that session | 10, ever |
| Searches | 5, ever |
| `web_crawl`, `web_scrape_batch` | Not included: need payment or a key |

Counters are per client (IP) and per UTC day.

---

## MCP

Streamable HTTP at `https://api.oassis.dev/mcp`. Published in the
[official MCP registry](https://registry.modelcontextprotocol.io) as `dev.oassis/scraper-crawler`,
and under the organization [github.com/oassisdev](https://github.com/oassisdev).

`initialize` and `tools/list` are always free.

---

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
