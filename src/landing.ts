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

/** The house stylesheet, shared by every page a person reads. */
export const STYLE = `<style>
  /**
   * GitHub's own reading page, because that is where this audience already reads:
   * its palette, its font stack, its rules under headings, its tables. Light by
   * default and dark when the reader's system is, exactly as a README renders.
   */
  :root {
    --bg:#ffffff; --fg:#1f2328; --muted:#59636e; --line:#d1d9e0;
    --link:#0969da; --code-bg:#f6f8fa; --ok:#1a7f37; --hero:#f6f8fa;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg:#0d1117; --fg:#e6edf3; --muted:#9198a1; --line:#3d444d;
      --link:#4493f8; --code-bg:#151b23; --ok:#3fb950; --hero:#151b23;
    }
  }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica,
              Arial, sans-serif; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:860px; margin:0 auto; padding:40px 24px 80px }

  /* The centred block a README opens with. */
  .hero { text-align:center; padding:8px 0 4px }
  .hero img.mark { width:72px; height:72px; margin-bottom:12px }
  h1 { font-size:32px; font-weight:600; line-height:1.25; margin:0 0 16px;
       padding-bottom:.3em; border-bottom:1px solid var(--line) }
  .hero h1 { border:0; padding:0; font-size:40px; letter-spacing:-.02em }
  .pitch { font-size:17px; font-weight:600; margin:0 0 18px }
  .cta { display:inline-block; font-size:17px; font-weight:600; margin:0 0 18px;
         color:var(--link); text-decoration:underline }
  .hero p { color:var(--fg); margin:0 auto 18px; max-width:620px }

  /* Shields, drawn here rather than fetched: one page, no third-party requests. */
  .badges { display:flex; gap:6px; flex-wrap:wrap; justify-content:center; margin:0 0 16px }
  .badge { display:inline-flex; border-radius:4px; overflow:hidden; font-size:11px;
           font-family:ui-monospace, SFMono-Regular, Menlo, monospace; line-height:20px }
  .badge span { padding:0 7px; color:#fff }
  .badge .k { background:#555 }
  .nav { color:var(--muted); font-size:15px; margin:0 }

  hr { border:0; border-top:1px solid var(--line); margin:32px 0 }

  h2 { font-size:24px; font-weight:600; margin:28px 0 16px;
       padding-bottom:.3em; border-bottom:1px solid var(--line) }
  h3 { font-size:18px; font-weight:600; margin:24px 0 10px }
  p { margin:0 0 16px }
  .muted { color:var(--muted); font-size:14px }

  a { color:var(--link); text-decoration:none }
  a:hover { text-decoration:underline }

  pre { background:var(--code-bg); border-radius:6px; padding:16px; overflow-x:auto;
        font-size:13.6px; line-height:1.45; margin:0 0 16px }
  code { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:85% }
  p code, li code, td code { background:var(--code-bg); border-radius:6px; padding:.2em .4em }

  table { border-collapse:collapse; margin:0 0 16px; width:100%; display:block;
          overflow-x:auto; font-size:15px }
  th, td { border:1px solid var(--line); padding:6px 13px; vertical-align:top }
  thead th { background:var(--code-bg); font-weight:600 }
  tbody tr:nth-child(2n) { background:var(--code-bg) }
  td.c, th.c { text-align:center }
  td.p { text-align:right; white-space:nowrap;
         font-family:ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ok) }
  td.n { color:var(--muted); font-size:13.5px }
  .yes { color:var(--ok); font-weight:600 }

  ul { padding-left:2em; margin:0 0 16px } li { margin:4px 0 }

  footer { margin-top:40px; padding-top:16px; border-top:1px solid var(--line);
           color:var(--muted); font-size:14px; text-align:center }
</style>`;

/** Escapes the four characters that can break out of our markup. */
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
${STYLE}
</head>
<body>
<div class="wrap">

<div class="hero">
<img class="mark" src="/favicon.svg" alt="" width="72" height="72">

<h1>oassis</h1>

<p class="pitch">Web scraping, crawling and browser control for AI agents.<br>
<strong>No API key. No signup. No monthly plan.</strong> Just USDC, per call.</p>

<a class="cta" href="${api}${prefix}/scrape">▶ See what a call costs, live in your browser — no install</a>

<p>Scrape any page or document to markdown, map and crawl whole sites, and drive a real
browser. Your agent answers a <code>402</code>, signs a payment from its own wallet and the
call runs — no account, no monthly plan, no human in the loop.</p>

<div class="badges">
  <span class="badge"><span class="k">x402</span><span style="background:#6f42c1">pay-per-call</span></span>
  <span class="badge"><span class="k">USDC</span><span style="background:#0052ff">Base mainnet</span></span>
  <span class="badge"><span class="k">MCP</span><span style="background:#0d9488">remote server</span></span>
  <span class="badge"><span class="k">license</span><span style="background:#2da44e">Elastic 2.0</span></span>
</div>

<p class="nav"><a href="${api}/openapi.json">OpenAPI</a> ·
<a href="${api}/llms.txt">llms.txt</a> ·
<a href="${api}/mcp">MCP</a> ·
<a href="${api}${prefix}/scrape">API reference</a></p>
</div>

<hr>

<h2>Why oassis</h2>

<p>A normal scraping API makes an agent stop and ask a human: sign up, create an account,
copy a key, add a card. oassis is <strong>callable the moment an agent has a funded
wallet</strong> — the server answers <code>HTTP 402</code> with the exact price of that
call, the agent signs a USDC payment on Base, and the content comes back. Under a second,
nobody in the loop.</p>

<table>
<thead><tr><th></th><th class="c">Scraper + key + plan</th><th class="c">Self-hosted browser</th><th class="c">oassis</th></tr></thead>
<tbody>
<tr><td>Sign-up / API key</td><td class="c">required</td><td class="c">—</td><td class="c"><span class="yes">none</span></td></tr>
<tr><td>Billing</td><td class="c">monthly / credits</td><td class="c">your servers</td><td class="c"><span class="yes">per call (USDC)</span></td></tr>
<tr><td>Agent can pay by itself</td><td class="c">✗</td><td class="c">✗</td><td class="c"><span class="yes">✓ (x402)</span></td></tr>
<tr><td>Charged when it fails</td><td class="c">usually</td><td class="c">you paid anyway</td><td class="c"><span class="yes">never</span></td></tr>
<tr><td>Free tier to try it</td><td class="c">varies</td><td class="c">—</td><td class="c"><span class="yes">✓ no account</span></td></tr>
<tr><td>MCP server</td><td class="c">varies</td><td class="c">build it</td><td class="c"><span class="yes">✓ included</span></td></tr>
</tbody>
</table>

<p>Prices start at ${escape(inDollars(PER_FORMAT.markdown))} a call, a balance never expires,
and a request we cannot serve is never charged for.</p>

<hr>

<h2>Try it without an account</h2>

<pre><code>curl -X POST ${api}${prefix}/scrape \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://oassis.dev","formats":["markdown","controls"]}'</code></pre>

<p>That answers <code>402</code> with the exact price of that call. Pay it with a wallet and
repeat the request, or send an API key and it is charged to a prepaid balance.</p>

<h3>Two doors, one API</h3>
<ul>
  <li><strong>MCP</strong> — point Claude, Cursor or any MCP client at <code>${api}/mcp</code>
  and the tools appear. <code>initialize</code> and <code>tools/list</code> are free, and a
  keyless client gets ${FREE_PER_DAY.scrape} page reads a day, ${FREE_PER_DAY.map} site
  listings a day, and — once — one browser session and ${FREE_EVER.searches} searches.</li>
  <li><strong>HTTP x402</strong> — <code>POST ${prefix}/&lt;route&gt;</code>. An unpaid request
  gets a <code>402</code> challenge, the client signs a USDC payment (EIP-3009 on Base) and
  retries. <code>GET</code> the same route without parameters and it describes itself instead
  of charging.</li>
</ul>

<hr>

<h2>What it costs</h2>

<table><tbody>${rows}</tbody></table>

<p class="muted">Priced per call, quoted before any work happens, and refunded when the work
does not happen. A request we cannot serve is never charged for.</p>

<hr>

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

<hr>

<h2>For agents</h2>

<ul>
  <li>MCP server: <code>${api}/mcp</code></li>
  <li>OpenAPI: <a href="${api}/openapi.json">${api}/openapi.json</a></li>
  <li>Plain text for models: <a href="${api}/llms.txt">${api}/llms.txt</a></li>
  <li>Every route describes itself: <code>GET ${api}${prefix}/scrape</code></li>
</ul>

<footer>
  oassis · <a href="${api}${prefix}/scrape">API reference</a> ·
  <a href="${api}/llms.txt">llms.txt</a> ·
  <a href="${api}/openapi.json">OpenAPI</a> ·
  <a href="${base}/privacy">Privacy</a> ·
  <a href="${base}/support">Support</a>
</footer>

</div>
</body>
</html>`;
}

/**
 * The two files a map asks a site for, answered from here when the site is us.
 *
 * A Worker cannot fetch its own hostname — the request loops back and never resolves —
 * so `web_map` came back empty for oassis.dev while mapping every other site correctly.
 * The one site we show in every example was the one our own tool could not read.
 *
 * Returns null for anyone else's host, which is the signal to go to the network.
 */
export function servedText(c: Context<{ Bindings: Env }>): (url: string) => string | null {
  const ours = new Set<string>();
  for (const host of [new URL(c.req.url).hostname, c.env.BASE_URL && new URL(c.env.BASE_URL).hostname]) {
    if (host) ours.add(host);
  }
  const apex = c.env.BASE_URL ? new URL(c.env.BASE_URL).hostname.split(".").slice(-2).join(".") : "";
  if (apex) {
    ours.add(apex);
    ours.add(`www.${apex}`);
    ours.add(`web.${apex}`);
    ours.add(`api.${apex}`);
  }

  return (candidate: string) => {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return null;
    }
    if (!ours.has(url.hostname)) return null;
    // Answer for the host that was asked for. Serving api.oassis.dev's sitemap to a
    // map of oassis.dev lists urls the map then throws away as belonging elsewhere.
    const base = url.origin;
    const label = url.hostname.split(".")[0] ?? "";
    const prefix = label === "web" ? "/v1" : "/web/v1";
    if (url.pathname === "/robots.txt") return robotsFor(base);
    if (url.pathname === "/sitemap.xml") return sitemapFor(base, prefix);
    // Ours, but not a file we serve: say so rather than letting it hang on the network.
    return "";
  };
}

/** Crawlers ask for this first. Letting them in is the whole point of having a page. */
export function robotsTxt(c: Context<{ Bindings: Env }>): string {
  return robotsFor(origin(c));
}

/** The same file, for a named host rather than the one that asked. */
export function robotsFor(base: string): string {
  return ["User-agent: *", "Allow: /", "", `Sitemap: ${base}/sitemap.xml`, ""].join("\n");
}

export function sitemapXml(c: Context<{ Bindings: Env }>): string {
  return sitemapFor(origin(c), prefixForHost(c));
}

/**
 * The same file, for a named host rather than the one that asked.
 *
 * The host matters: a sitemap listing another host's urls is a sitemap whose every
 * entry a map then discards as off-site.
 */
export function sitemapFor(base: string, prefix: string): string {
  const urls = ["/", `${prefix}/scrape`, "/llms.txt", "/openapi.json", "/privacy", "/support"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${base}${u === "/" ? "/" : u}</loc></url>`).join("\n")}
</urlset>
`;
}
