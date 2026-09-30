# oassis — web scraping, crawling and browser control API for AI agents

Scrape any page or document to **markdown**, map and crawl whole sites, and drive a **real
browser**. Pay per call with a wallet: **no API key, no signup, no monthly plan.**

**[oassis.dev](https://oassis.dev)** · MCP: `https://api.oassis.dev/mcp` ·
[OpenAPI](https://api.oassis.dev/openapi.json) · [llms.txt](https://api.oassis.dev/llms.txt)

## Try it without an account

```bash
curl -X POST https://api.oassis.dev/web/v1/scrape \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown","controls"]}'
```

That answers `402` with the exact price of that call, in the `PAYMENT-REQUIRED` header.
Pay it with a wallet (x402, USDC on Base) and repeat the request — or send
`Authorization: Bearer oas_…` and it comes out of a prepaid balance.

**Every route answers its own `GET`**, free, with the fields it expects. No manual needed:

```bash
curl https://api.oassis.dev/web/v1/scrape
```

## What it does that a scraper usually does not

- **A map of the controls.** Ask for `controls` and you get every link, button and field
  with its role, its readable name, its selector and where it sits on screen — the map an
  agent needs to decide what to click. In one render.
- **Browser sessions that stay open.** Look, click, look again, without reloading and
  without losing state. The `ref`s from `controls` still work on the next call.
- **Documents by url.** A PDF, Word, Excel or CSV comes back as markdown with no browser
  involved.
- **Every output in one call.** `markdown`, `html`, `links`, `controls`, `accessibility`,
  `elements`, `screenshot`, `pdf`, or AI-extracted `json`. A format that fails does not void
  the rest.

## Endpoints

| | |
| --- | --- |
| `POST /web/v1/scrape` | Read a page or a document |
| `POST /web/v1/session` · `/act` | Open a browser and act on it |
| `POST /web/v1/scrape/batch` | Read a list of urls, as a job |
| `POST /web/v1/map` | Every url of a site, from its sitemap |
| `POST /web/v1/crawl` | Follow a site's links and read it, as a job |
| `POST /web/v1/search/exa` | Search the web, at the provider's own price |
| `POST /mcp` | The same tools over MCP |

Served on two hosts: `api.oassis.dev` (`/web/v1/…`) and `web.oassis.dev` (`/v1/…`).

## Prices

| | |
| --- | --- |
| One output of a page | **$0.001** |
| A cached answer | $0.0002 |
| A document by url | $0.002 |
| A site's urls from its sitemap | $0.0003 |
| A browser session, first minute | $0.005 |
| Each minute after | $0.004 |
| Each action | $0.0005 |
| A search | $0.007, passed through |

Quoted before the work happens, charged after, and **refunded when the work does not
happen**. A request that cannot be served is never charged for. Balance does not expire and
there is no monthly fee.

## MCP

Streamable HTTP at `https://api.oassis.dev/mcp`, listed in the
[official registry](https://registry.modelcontextprotocol.io) as `dev.oassis/scraper-crawler`.

`initialize` and `tools/list` are free. A keyless client gets a small allowance — 10 page
reads a day, one browser session and a few searches — so the first call works before any
account exists.

## Running it

```bash
npm install
npm run check      # typecheck, dead-export scan, tests
npm run deploy     # Cloudflare Workers
```

Needs a D1 database, a KV namespace and the Browser Run binding; see `wrangler.jsonc`.
Payments need `X402_PAY_TO` and, for settlement on Base mainnet, CDP keys.

## License

[Elastic License 2.0](LICENSE). Read it, run it, change it, host it for yourself — you may
not offer it to third parties as a hosted or managed service. Source-available, not open
source, and the difference is that one sentence.
