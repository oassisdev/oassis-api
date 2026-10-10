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

  .chips { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; margin:0 0 8px }
  .chip { border:1px solid var(--line); border-radius:999px; padding:2px 12px; font-size:14px;
          color:var(--muted) }
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:12px;
          margin:0 0 16px }
  .card { border:1px solid var(--line); border-radius:8px; padding:14px 16px }
  .card .tag { font-size:12px; color:var(--ok); font-weight:600 }
  .card h3 { font-size:16px; margin:4px 0 6px }
  .card p { font-size:14.5px; margin:0 0 8px; color:var(--fg) }
  .card .price { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px;
                 color:var(--muted) }
  details { border-top:1px solid var(--line); padding:12px 0 }
  details:last-of-type { border-bottom:1px solid var(--line) }
  summary { font-weight:600; cursor:pointer }
  details p { margin:8px 0 0 }

  footer { margin-top:40px; padding-top:16px; border-top:1px solid var(--line);
           color:var(--muted); font-size:14px; text-align:center }
</style>`;

/** Landing-only styles: legal and support pages keep the shared reading stylesheet. */
const LANDING_STYLE = `<style>
.oassis-home { --bg:#edf5f8; --fg:#102d42; --muted:#526879; --line:#c9dae3; --link:#2458c8; --code-bg:#e4eef4; background:var(--bg); font-family:"Segoe UI",Arial,sans-serif; }
.oassis-home .wrap {max-width:1240px;padding:0 40px 64px}
.oassis-home h1,.oassis-home h2,.oassis-home h3 {font-family:"Trebuchet MS","Segoe UI",sans-serif;border:0;padding:0;letter-spacing:-.035em}
.oassis-home h2 {font-size:clamp(30px,4vw,46px);line-height:1.1;margin:0 0 24px;max-width:760px}
.oassis-home h3 {letter-spacing:-.015em}
.oassis-home a:focus-visible,.oassis-home button:focus-visible,.oassis-home summary:focus-visible {outline:3px solid #b57912;outline-offset:5px}
.site-nav {display:flex;align-items:center;justify-content:space-between;padding:26px 0;gap:24px}
.brand {display:flex;align-items:center;gap:10px;color:#102d42;font-size:27px;font-weight:700;letter-spacing:-1px}
.brand img {width:35px;height:35px}
.site-nav nav {display:flex;gap:26px;font-size:14px;font-weight:600;align-items:center}
.oassis-home .nav-connect {border:1px solid #a7c0d0;padding:9px 16px;border-radius:7px;color:#102d42}
.launch {background:#102d42;color:#fff;border-radius:24px;padding:58px 48px 32px;position:relative;overflow:hidden}
.launch-top {display:grid;grid-template-columns:1.15fr 1fr;gap:50px;align-items:end;margin-bottom:44px}
.oassis-home .launch h1 {font-size:clamp(46px,6.2vw,78px);line-height:1.02;margin:0;letter-spacing:-.055em;color:white}
.launch-copy p {color:#cedfe9;font-size:18px;line-height:1.6;max-width:470px;margin:0 0 24px}
.launch-actions {display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.oassis-home .button {display:inline-flex;align-items:center;justify-content:center;padding:12px 19px;border-radius:8px;background:#fff;color:#102d42;font-weight:700;font-size:14px;text-decoration:none;border:1px solid transparent;cursor:pointer;min-height:46px}
.oassis-home .button.secondary {background:transparent;color:white;border-color:#617f92}
.launch .connection-note {font-size:12px;margin:15px 0 0;color:#c2d6e2}
.workflow {display:grid;grid-template-columns:235px minmax(0,1fr);background:#fff;color:#102d42;border-radius:14px;overflow:hidden;min-height:350px}
.workflow-menu {padding:22px;background:#e5eef3;display:flex;flex-direction:column;gap:6px}
.workflow-menu p {font-size:12px;color:#526879;margin:0 0 10px}
.workflow-step {border:0;background:transparent;color:#385568;text-align:left;display:flex;align-items:center;gap:14px;border-radius:7px;padding:12px;font:600 15px "Segoe UI",sans-serif;cursor:pointer;min-height:45px}
.workflow-step span {font-size:12px;color:#526879;width:20px;font-variant-numeric:tabular-nums}
.workflow-step[aria-pressed="true"] {background:#102d42;color:white}
.workflow-step[aria-pressed="true"] span {color:#e9ad45}
.workflow-view {padding:28px 30px;min-width:0}
.workflow-header {display:flex;justify-content:space-between;gap:12px;align-items:center;padding-bottom:18px;border-bottom:1px solid #dce7ee;font-size:13px;color:#526879}
.demo-label {background:#fff2da;color:#795006;padding:3px 9px;border-radius:5px;white-space:nowrap}
.workflow-panel h3 {font-size:26px;margin:20px 0 10px}
.workflow-panel p {font-size:14px;max-width:620px;color:#526879;margin-bottom:16px}
.oassis-home .workflow-panel pre {background:#f0f5f8;color:#163c55;border:1px solid #dce7ee;border-radius:8px;font-size:13px;margin:0;line-height:1.65;padding:17px}
.workflow-panel[hidden] {display:none}
.workflow-caption {font-size:12px;margin:16px 0 0;color:#c2d6e2;max-width:780px}
.intro-band {display:grid;grid-template-columns:1fr 2fr;gap:45px;padding:50px 8px;align-items:start}
.intro-band .descriptor {font-size:15px;color:#526879;max-width:240px}
.intro-band .statement {font-family:"Trebuchet MS",sans-serif;font-size:clamp(22px,3vw,34px);line-height:1.35;letter-spacing:-.025em;margin:0}
.oassis-home .content-section {padding:46px 0;border-top:1px solid #c9dae3;scroll-margin-top:24px}
.section-lead {max-width:690px;color:#526879;margin-bottom:28px;font-size:17px}
.oassis-home .grid {grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border-top:1px solid #c9dae3}
.oassis-home .card {border:0;border-bottom:1px solid #c9dae3;border-radius:0;padding:25px 22px 25px 0;background:transparent}
.oassis-home .card h3 {font-size:19px;margin:9px 0 12px}
.oassis-home .card p {color:#526879;line-height:1.6}
.oassis-home .card .tag {color:#2458c8;font-size:12px}
.oassis-home .card .price {font-family:inherit;font-size:13px;color:#526879}
.oassis-home .connect-panel {background:white;border:1px solid #c9dae3;border-radius:16px;padding:32px;margin-top:25px}
.oassis-home .connect-panel pre {background:#102d42;color:#e5f2fa;padding:23px;border-radius:9px}
.oassis-home table {display:table;background:white;font-size:14px}
.oassis-home td {border:0;border-bottom:1px solid #dce7ee;padding:17px 20px}
.oassis-home tbody tr:nth-child(2n) {background:#f5f9fb}
.oassis-home td.p {color:#2458c8;font-size:15px}
.oassis-home footer {text-align:left;display:flex;flex-wrap:wrap;gap:12px;line-height:2}
.skip-link {position:absolute;left:20px;top:-100px;background:white;padding:10px;z-index:5}
.skip-link:focus {top:12px}
@media(max-width:800px){.oassis-home .wrap{padding:0 20px 40px}.launch{padding:34px 24px 24px}.launch-top{grid-template-columns:1fr;gap:24px}.workflow{grid-template-columns:1fr}.workflow-menu{flex-direction:row;overflow-x:auto;padding:12px;gap:5px}.workflow-menu p{display:none}.workflow-step{white-space:nowrap;padding:10px}.workflow-view{padding:20px}.intro-band{grid-template-columns:1fr;gap:14px;padding:34px 0}.intro-band .descriptor{max-width:none}.oassis-home .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.site-nav nav{gap:16px}.site-nav .nav-reference{display:none}}
@media(max-width:480px){.oassis-home .wrap{padding:0 14px 32px}.site-nav{padding:19px 5px}.site-nav nav{gap:14px}.brand{font-size:23px}.brand img{width:28px;height:28px}.site-nav .nav-pricing{display:none}.launch{border-radius:16px;padding:30px 18px 20px}.oassis-home .launch h1{font-size:46px}.launch-copy p{font-size:16px}.workflow-view{padding:16px}.workflow-header{font-size:11px}.workflow-panel h3{font-size:23px}.oassis-home .grid{grid-template-columns:1fr}.oassis-home .connect-panel{padding:20px}.oassis-home table{display:block;overflow:auto}.oassis-home td{padding:13px 14px}.oassis-home .content-section{padding:35px 0}}
@media(prefers-reduced-motion:no-preference){.workflow-panel{animation:panel-in .18s ease-out}@keyframes panel-in{from{opacity:.5;transform:translateY(4px)}to{opacity:1;transform:none}}}
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

  const tools: [string, string, string, string][] = [
    ["web_scrape", "Read a page or document as markdown, html, links, controls, accessibility, elements, screenshot, pdf or json.", `${inDollars(PER_FORMAT.markdown)} per output`, "Over MCP: free"],
    ["web_map", "List a site's urls, from its sitemap and optionally the page itself.", inDollars(mapPrice(false)), "Over MCP: free"],
    ["web_session_open", "Open a real browser on a page and get its map of controls.", `${inDollars(PRICES.sessionOpen)} first minute`, "Over MCP: free"],
    ["web_act", "Click, type, select, scroll and wait on an open session.", `${inDollars(PRICES.action)} per action`, "Over MCP: free"],
    ["web_scrape_batch", "Read a list of urls you give it, as a background job.", "one scrape per url", "Over MCP: free"],
    ["web_crawl", "Follow a site's links and read every page, as a background job.", "per page read", "Over MCP: free"],
    ["web_batch_status", "Check a batch: status, results, or cancel it.", "free", "Over MCP: free"],
    ["web_crawl_status", "Check a crawl: pages read, discovered, still queued.", "free", "Over MCP: free"],
    ["web_session_close", "Close a session and stop browser time.", "free", "Over MCP: free"],
    ["web_search_exa", "Search the web with Exa's index.", "Exa's price, about $0.007", "Paid: x402 or key"],
    ["web_feedback", "Report a result that was wrong.", "free", "Over MCP: free"],
  ];
  const toolCards = tools
    .map(
      ([name, what, price, tag]) =>
        `<div class="card"><div class="tag">${escape(tag)}</div><h3><code>${escape(name)}</code></h3><p>${escape(what)}</p><div class="price">${escape(price)}</div></div>`,
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
${LANDING_STYLE}
</head>
<body class="oassis-home">
<a class="skip-link" href="#main">Skip to content</a>
<div class="wrap">
<header class="site-nav"><a class="brand" href="/" aria-label="oassis home"><img src="/favicon.svg" alt="" width="35" height="35">oassis</a><nav aria-label="Main navigation"><a class="nav-reference" href="${api}/openapi.json">API reference</a><a class="nav-pricing" href="#pricing">Pricing</a><a class="nav-connect" href="#try">Connect your agent</a></nav></header>
<main id="main">
<section class="launch" aria-labelledby="hero-title">
<div class="launch-top"><h1 id="hero-title">Give your agent<br>the web to work with.</h1><div class="launch-copy"><p>Find the right page. Read what matters. Open a browser and take the next step. Web infrastructure for AI agents, through one API.</p><div class="launch-actions"><a class="button" href="#try">Connect via MCP</a><a class="button secondary" href="${api}/openapi.json">Explore the API</a></div><p class="connection-note">No API key. No signup. Free over MCP, except search.</p></div></div>
<div class="workflow" aria-label="Example agent workflow">
<div class="workflow-menu" role="group" aria-label="Explore workflow steps"><p>One possible agent workflow</p>
<button type="button" class="workflow-step" data-step="search" aria-pressed="true" aria-controls="panel-search"><span>01</span>Search</button>
<button type="button" class="workflow-step" data-step="scrape" aria-pressed="false" aria-controls="panel-scrape"><span>02</span>Scrape</button>
<button type="button" class="workflow-step" data-step="crawl" aria-pressed="false" aria-controls="panel-crawl"><span>03</span>Crawl</button>
<button type="button" class="workflow-step" data-step="browser" aria-pressed="false" aria-controls="panel-browser"><span>04</span>Browser session</button>
<button type="button" class="workflow-step" data-step="act" aria-pressed="false" aria-controls="panel-act"><span>05</span>Act</button>
</div><div class="workflow-view"><div class="workflow-header"><span>Task: read a page and act on it</span><span class="demo-label">Illustrative demo</span></div>
<div class="workflow-panel" id="panel-search"><h3>Start with a question.</h3><p>Find candidate pages with Exa search. Your agent chooses which sources to read next.</p><pre><code>web_search_exa
{ "query": "your search terms", "limit": 5 }

Example result
{ "title": "Example title", "url": "https://example.com/page" }</code></pre></div>
<div class="workflow-panel" id="panel-scrape" hidden><h3>Read content. See the controls.</h3><p>Get markdown and the links, buttons and fields your agent can interact with in the same call.</p><pre><code>web_scrape
{ "url": "https://example.com/page",
  "formats": ["markdown", "controls"] }

Example content: "Example page text."
Example control: { "role": "button", "name": "Example button" }</code></pre></div>
<div class="workflow-panel" id="panel-crawl" hidden><h3>Follow the useful pages.</h3><p>Map a site first, then crawl the pages you need. Collect the results from a background job.</p><pre><code>web_crawl
{ "url": "https://example.com/page", "limit": 10 }

Returns a jobId
web_crawl_status { "jobId": "example-job" }</code></pre></div>
<div class="workflow-panel" id="panel-browser" hidden><h3>Keep the browser open.</h3><p>Open a session when the page needs interaction. Observe the controls and continue on the same state.</p><pre><code>web_session_open
{ "url": "https://example.com/page",
  "formats": ["controls", "markdown"] }

Returns a sessionId and controls
Example ref: "button#2"</code></pre></div>
<div class="workflow-panel" id="panel-act" hidden><h3>Take the next step.</h3><p>Use an observed control to click, type or select. Read the resulting state, then close the session.</p><pre><code>web_act
{ "sessionId": "example-session",
  "actions": [{ "click": { "ref": "button#2" } }],
  "formats": ["markdown", "controls"] }

web_session_close { "sessionId": "example-session" }</code></pre></div>
</div></div><p class="workflow-caption">Select a step to inspect an example. No requests are sent. Your agent decides the workflow; Oassis provides the web tools.</p>
</section>
<div class="intro-band"><p class="descriptor">Search, scraping, crawling and browser control.</p><p class="statement">The web is more than text.<br>Give your agent the content, the controls, and a browser that remembers where it is.</p></div>
<section class="content-section" id="tools">
<h2>Tools your agents can call</h2>

<p>Every tool is live today. Each one works over MCP, or as a pay-per-call x402 endpoint.</p>

<div class="grid">${toolCards}</div>

</section>
<section class="content-section">
<h2>From a page to the next action.</h2>

<div class="grid">
  <div class="card"><h3>Read any page</h3><p>Markdown, html, links and a map of every control, in one call. A PDF, Word, Excel or CSV url comes back as markdown without a browser.</p></div>
  <div class="card"><h3>Act on the page</h3><p>Open a session and it stays open: look, click, type, look again. The control references keep working between calls.</p></div>
  <div class="card"><h3>Pay only per call</h3><p>Prices start at ${escape(inDollars(PER_FORMAT.markdown))}. A prepaid balance never expires. Failed work paid from that balance is credited back.</p></div>
</div>

</section>
<section class="content-section" id="try">
<h2>Connect once. Put the web to work.</h2>
<div class="connect-panel"><h3>Connect through MCP</h3><p>Point your MCP client at <code>${api}/mcp</code>. Every tool except search works without an account.</p><pre><code>claude mcp add --transport http oassis ${api}/mcp</code></pre><button class="button" type="button" id="copy-mcp">Copy MCP URL</button><p id="copy-status" class="muted" role="status"></p></div>
<h3>Or call the HTTP API</h3>

<p>An unpaid request answers <code>402</code> with the exact price of that call. The agent signs
a USDC payment on Base from its own wallet and repeats the request. No account, no human in
the loop, and the facilitator pays the gas.</p>

<pre><code>curl -X POST ${api}${prefix}/scrape \
  -H 'content-type: application/json' \
  -d '{"url":"https://oassis.dev","formats":["markdown","controls"]}'</code></pre>

<p>That answers <code>402</code> with the price of that call. Pay it with a wallet and repeat the
request, or send an API key and it is charged to a prepaid balance.</p>

<h3>Over MCP, with no key</h3>

<p>Every tool works without a key, except search, which Exa charges for. Send your client's own
User-Agent: requests with the default of <code>curl</code> or an HTTP library are refused.</p>

<pre><code>curl -X POST ${api}/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'user-agent: MyAgent/1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</code></pre>

<h3>Two doors, one API</h3>
<ul>
  <li><strong>MCP</strong> — point Claude, Cursor or any MCP client at <code>${api}/mcp</code>.</li>
  <li><strong>HTTP x402</strong> — <code>POST ${prefix}/&lt;route&gt;</code>. Each route describes itself
  on <code>GET</code>, free and without parameters.</li>
</ul>

</section>
<section class="content-section" id="pricing">
<h2>Small calls. Explicit prices.</h2>

<table><tbody>${rows}</tbody></table>

<p class="muted">Priced per call, quoted before any work happens. A wallet payment is settled
on-chain and cannot be reversed from here; a failed call paid with an API-key balance is credited back.</p>

</section>
<section class="content-section">
<h2>A few things to know.</h2>

<details>
  <summary>What is oassis?</summary>
  <p>A web-reading API for agents. It scrapes any page or document to markdown, maps and crawls whole
  sites, and drives a real browser. You reach it over MCP or over HTTP.</p>
</details>
<details>
  <summary>Do I need an account or an API key?</summary>
  <p>No. Over MCP every tool works without a key, except search. Over HTTP each call is paid per call
  with a wallet (x402). An API key is optional, for a prepaid balance.</p>
</details>
<details>
  <summary>What is x402?</summary>
  <p>An open, HTTP-native payment standard. An unpaid request answers <code>402</code> with the price;
  the client signs a small USDC payment on Base and retries the same request.</p>
</details>
<details>
  <summary>What is MCP?</summary>
  <p>The Model Context Protocol, an open standard that lets AI clients connect to external tools.
  Point your client at <code>${api}/mcp</code> and the tools appear.</p>
</details>
<details>
  <summary>How much does it cost?</summary>
  <p>From ${escape(inDollars(PER_FORMAT.markdown))} per output, priced per call and quoted before the
  work runs. Search is passed through at the price Exa charges.</p>
</details>
<details>
  <summary>Am I charged when something fails?</summary>
  <p>Failed work paid from an API-key balance is credited back. Wallet payments settle on-chain and cannot be reversed from here; the 402 quotes the price before you pay.</p>
</details>
<details>
  <summary>Which clients work with it?</summary>
  <p>Any MCP client over MCP, and any x402-capable client or wallet over HTTP.</p>
</details>
<details>
  <summary>Is it free to try?</summary>
  <p>Yes, over MCP. Every tool except search runs without a key or a daily limit. Reads respect
  robots.txt.</p>
</details>

</section>
</main>
<footer>
  oassis · <a href="${api}${prefix}/scrape">API reference</a> ·
  <a href="${api}/mcp">MCP</a> ·
  <a href="${api}/llms.txt">llms.txt</a> ·
  <a href="${api}/openapi.json">OpenAPI</a> ·
  <a href="${base}/privacy">Privacy</a> ·
  <a href="${base}/terms">Terms</a> ·
  <a href="${base}/support">Support</a>
</footer>

</div>
<script>
(function () {
  var steps = document.querySelectorAll('[data-step]');
  steps.forEach(function (button) {
    button.addEventListener('click', function () {
      steps.forEach(function (step) { step.setAttribute('aria-pressed', String(step === button)); });
      document.querySelectorAll('.workflow-panel').forEach(function (panel) { panel.hidden = panel.id !== 'panel-' + button.dataset.step; });
    });
  });
  document.getElementById('copy-mcp').addEventListener('click', async function () {
    var status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(${JSON.stringify(api + "/mcp")});
      status.textContent = 'MCP URL copied.';
    } catch (_) {
      status.textContent = 'Copy this URL: ' + ${JSON.stringify(api + "/mcp")};
    }
  });
})();
</script>
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
  const urls = ["/", `${prefix}/scrape`, "/llms.txt", "/openapi.json", "/privacy", "/terms", "/support"];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${base}${u === "/" ? "/" : u}</loc></url>`).join("\n")}
</urlset>
`;
}
