/**
 * The one page written for a person.
 *
 * Everything else this Worker answers is for machines: JSON, a catalogue, a protocol. A
 * human who hears the name and types the domain got a browser error, which reads as "this
 * does not exist" rather than "this is an API".
 *
 * It is served by the Worker itself rather than by a second project, because one page does
 * not justify a second build, a second deploy and a second thing to keep in sync. If this
 * ever grows into a site with a blog and half a dozen pages, that is the moment to move it
 * out, not before.
 *
 * **Its prices come from the same table the API charges from.** A landing page that quotes
 * a price the API does not charge is worse than no page at all.
 */

import type { Context } from "hono";
import { ICON_LINKS } from "./icon";
import { PER_FORMAT, PRICES, inDollars, mapPrice } from "./billing/prices";
import { origin, prefixForHost } from "./http";
import { FREE_EVER, FREE_PER_DAY } from "./free-tier";
import type { Env } from "./types";

/** What the page claims to be, in the words somebody would search for. */
const TITLE = "oassis — web scraping, crawling and browser control API for AI agents";
const DESCRIPTION =
  "Scrape any page or document to markdown, map and crawl whole sites, and drive a real browser. " +
  "Pay per call with a wallet — no API key, no signup, no monthly plan.";

const escape = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function landing(c: Context<{ Bindings: Env }>): string {
  const base = origin(c);
  const api = c.env.BASE_URL ?? base;
  const prefix = prefixForHost(c);

  const prices: [string, string, string][] = [
    ["Read a page", inDollars(PER_FORMAT.markdown), "per output asked for: markdown, html, links, controls…"],
    ["Read a document", inDollars(PRICES.document), "PDF, Word, Excel or CSV by url, no browser"],
    ["From the cache", inDollars(PRICES.cacheHit), "a recent render, priced before you are charged"],
    ["List a site's urls", inDollars(mapPrice(false)), "from its sitemap"],
    ["Open a browser session", inDollars(PRICES.sessionOpen), "includes the first minute"],
    ["Act on the page", inDollars(PRICES.action), "click, type, select, scroll, wait"],
    ["Search the web", "$0.007", "passed through at what the provider charges"],
  ];

  const rows = prices
    .map(
      ([what, price, note]) =>
        `<tr><td>${escape(what)}</td><td class="p">${escape(price)}</td><td class="n">${escape(note)}</td></tr>`,
    )
    .join("");

  /** Search engines read this, and it is the only structured claim about what this is. */
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebAPI",
    name: "oassis",
    description: DESCRIPTION,
    url: base,
    documentation: `${api}/openapi.json`,
    provider: { "@type": "Organization", name: "oassis" },
    offers: {
      "@type": "Offer",
      price: (PER_FORMAT.markdown / 1_000_000).toFixed(4),
      priceCurrency: "USD",
      description: "Per call. No subscription.",
    },
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(TITLE)}</title>
<meta name="description" content="${escape(DESCRIPTION)}">
<link rel="canonical" href="${base}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${escape(TITLE)}">
<meta property="og:description" content="${escape(DESCRIPTION)}">
<meta property="og:url" content="${base}/">
<meta name="twitter:card" content="summary">
<meta property="og:image" content="${base}/icon-512.png">
<meta name="twitter:image" content="${base}/icon-512.png">
${ICON_LINKS}
<script type="application/ld+json">${jsonLd}</script>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --line:#30363d; --text:#e6edf3; --dim:#8b949e; --accent:#58a6ff; --ok:#3fb950; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text);
         font:16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:56px 20px 80px }
  h1 { font-size:34px; line-height:1.2; margin:0 0 16px; letter-spacing:-.02em }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim);
       margin:48px 0 12px; font-weight:600 }
  p.lead { font-size:19px; color:#c9d1d9; margin:0 0 28px }
  .badges { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:32px }
  .badge { border:1px solid var(--line); background:var(--panel); border-radius:999px;
           padding:5px 12px; font-size:13px; color:var(--dim) }
  .badge b { color:var(--ok); font-weight:600 }
  pre { background:var(--panel); border:1px solid var(--line); border-radius:8px;
        padding:16px; overflow-x:auto; font-size:13.5px; line-height:1.55 }
  code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace }
  table { width:100%; border-collapse:collapse; font-size:15px }
  td { padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top }
  td.p { text-align:right; white-space:nowrap; font-family:ui-monospace,Menlo,monospace; color:var(--ok) }
  td.n { color:var(--dim); font-size:13.5px }
  a { color:var(--accent) }
  ul { padding-left:20px } li { margin:6px 0 }
  footer { margin-top:56px; padding-top:20px; border-top:1px solid var(--line);
           color:var(--dim); font-size:14px }
</style>
</head>
<body>
<div class="wrap">

<h1>Web scraping and browser control, for agents that pay for themselves</h1>
<p class="lead">Scrape any page or document to markdown, map and crawl whole sites, and drive a
real browser. <strong>No API key. No signup. No monthly plan.</strong> Your agent answers a
402 and the call runs.</p>

<div class="badges">
  <span class="badge"><b>·</b> pay per call, from ${escape(inDollars(PER_FORMAT.markdown))}</span>
  <span class="badge"><b>·</b> USDC on Base (x402)</span>
  <span class="badge"><b>·</b> MCP server included</span>
  <span class="badge"><b>·</b> balance never expires</span>
</div>

<h2>Try it without an account</h2>
<pre><code>curl -X POST ${api}${prefix}/scrape \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://example.com","formats":["markdown","controls"]}'</code></pre>
<p>That answers <code>402</code> with the exact price of that call. Pay it with a wallet and
repeat the request, or send an API key and it is charged to a prepaid balance.</p>

<h2>What it costs</h2>
<table><tbody>${rows}</tbody></table>
<p class="lead" style="font-size:15px;color:var(--dim);margin-top:14px">Priced per call, quoted
before any work happens, and refunded when the work does not. A request we cannot serve is
never charged for.</p>

<h2>What it does that a scraper usually does not</h2>
<ul>
  <li><strong>A map of the controls.</strong> Ask for <code>controls</code> and you get every
  link, button and field with its role, its readable name and where it sits on screen — the
  map an agent needs to decide what to click.</li>
  <li><strong>Browser sessions that stay open.</strong> Look, click, look again, without
  reloading and without losing state.</li>
  <li><strong>Documents by url.</strong> A PDF, Word, Excel or CSV comes back as markdown
  without opening a browser at all.</li>
  <li><strong>Every output in one call.</strong> markdown, html, links, controls, the
  accessibility tree, elements by selector, a screenshot, a PDF, or AI-extracted JSON.</li>
</ul>

<h2>For agents</h2>
<ul>
  <li>MCP server: <code>${api}/mcp</code> — <code>initialize</code> and <code>tools/list</code>
  are free, and a keyless client gets ${FREE_PER_DAY.scrape} reads a day, one browser session
  and ${FREE_EVER.searches} searches to try it.</li>
  <li>OpenAPI: <a href="${api}/openapi.json">${api}/openapi.json</a></li>
  <li>Plain text for models: <a href="${api}/llms.txt">${api}/llms.txt</a></li>
  <li>Every route describes itself: <code>GET ${api}${prefix}/scrape</code></li>
</ul>

<footer>
  oassis · <a href="${api}${prefix}/scrape">API reference</a> ·
  <a href="${api}/llms.txt">llms.txt</a> ·
  <a href="${api}/openapi.json">OpenAPI</a>
</footer>

</div>
</body>
</html>`;
}

/** Crawlers ask for this first. Letting them in is the whole point of having a page. */
export function robotsTxt(c: Context<{ Bindings: Env }>): string {
  return ["User-agent: *", "Allow: /", "", `Sitemap: ${origin(c)}/sitemap.xml`, ""].join("\n");
}

export function sitemapXml(c: Context<{ Bindings: Env }>): string {
  const base = origin(c);
  const urls = ["/", `${prefixForHost(c)}/scrape`, "/llms.txt", "/openapi.json"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${base}${u === "/" ? "/" : u}</loc></url>`).join("\n")}
</urlset>
`;
}
