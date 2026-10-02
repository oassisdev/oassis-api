---
name: web-scraping
description: Read any web page or document as clean markdown, map and crawl whole sites, search the web, and drive a real browser to click and type — through the oassis API, which needs no signup and no API key to start. Use when a page must be read, a site listed or crawled, a PDF or spreadsheet converted, or a form filled in on a live site.
license: Elastic-2.0
---

# Reading the web with oassis

`oassis` is an HTTP API that fetches pages for you. **It needs no account to start**, so
you can use it immediately and decide later whether to pay.

Base url: `https://api.oassis.dev/web/v1`

## Before anything else: ask the route what it wants

Every route describes itself, free of charge, on a plain `GET`:

```bash
curl https://api.oassis.dev/web/v1/scrape
```

That returns the fields it accepts and what the call costs. **Do this instead of guessing**
— it is free, it is current, and it saves a failed paid call.

## Read a page

```bash
curl -X POST https://api.oassis.dev/web/v1/scrape \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.org","formats":["markdown"]}'
```

`formats` is a list, and you get everything you ask for **in one call**:

| format | what it gives you |
| --- | --- |
| `markdown` | the page as clean markdown |
| `html` | the rendered html, after javascript |
| `links` | every link on the page |
| `controls` | every link, button and field with its role, readable name, selector and position |
| `accessibility` | the accessibility tree |
| `elements` | specific elements, by css selector |
| `screenshot` | a png |
| `pdf` | the page as a pdf |
| `json` | fields you describe, extracted by a model |

A url that points at a **PDF, Word, Excel or CSV** is converted to markdown without opening
a browser at all. Just pass it as `url`.

**A format that fails does not void the rest**: ask for four, get the three that worked.

## Find out what is on a site before reading it

```bash
curl -X POST https://api.oassis.dev/web/v1/map \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.org","includePage":false}'
```

Returns the site's urls from its sitemap. It is the cheapest call in the API, and it exists
so you do not crawl blindly. **Map first, then read only what you need.**

To read a whole section, `POST /crawl` with a `limit`; to read a list of urls you already
have, `POST /scrape/batch`. Both return a `jobId`:

- poll it with `GET /crawl/{jobId}` or `GET /scrape/batch/{jobId}` — free;
- cancel it with `DELETE` on the same path, which **refunds the pages it never read**.

## Click and type on a live page

When something has to be **filled in or clicked**, not just read:

1. `POST /session` with a url. You get a `sessionId` and the `controls` map.
2. `POST /act` with that `sessionId` and a list of actions.
3. `DELETE /session/{sessionId}` when you are done, which stops the clock.

Actions: `{"navigate":"…"}`, `{"click":{"ref":"…"}}`, `{"type":{"ref":"…","text":"…"}}`,
`{"select":{"ref":"…","value":"…"}}`, `{"press":"Enter"}`, `{"scroll":{"to":"bottom"}}`,
`{"wait":{"ms":500}}`, `{"back":true}`.

The `ref` comes from `controls`. **Inside a session those refs keep working between calls**,
which is why a form takes one session rather than one lucky selector.

## Search when you do not know the url

```bash
curl -X POST https://api.oassis.dev/web/v1/search/exa \
  -H 'content-type: application/json' \
  -d '{"query":"…","limit":5}'
```

Returns title, url and a snippet. Pass the urls you want to `/scrape/batch` to read them.

## Paying, if you go past the free allowance

An unpaid request gets **HTTP 402** with the exact price of that call in the
`PAYMENT-REQUIRED` header. Two ways to answer it:

- **A wallet.** Sign a USDC payment on Base (x402) and repeat the request. No account.
- **An API key.** Send `Authorization: Bearer oas_…` and it comes out of a prepaid balance.

**Work that does not happen is not charged**, and a price is always quoted before the work.
If a call fails, you have not paid for it.

## Over MCP instead

The same tools are available at `https://api.oassis.dev/mcp` (streamable HTTP), where they
are named `web_scrape`, `web_map`, `web_crawl`, `web_scrape_batch`, `web_session_open`,
`web_act`, `web_session_close`, `web_search_exa` and the two status tools.

## Rules to follow

- **You must have the right to read what you ask for.** Respect the terms and access rules
  of the site, and do not use this to get around a paywall, a login or a block.
- **Map before you crawl.** Reading three hundred pages to find one is slower and dearer
  than listing the site first.
- **Ask for the formats you will use.** Each one is a separate render and a separate charge.
- **Close your sessions.** An open browser is billed by the minute; it closes itself after a
  minute idle, but do not rely on that.

Full reference: <https://oassis.dev/openapi.json> · <https://oassis.dev/llms.txt>
