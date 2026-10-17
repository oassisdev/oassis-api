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
import { CREDIT_PACKAGES } from "./billing/credits";
import { ICON_LINKS } from "./icon";
import { PER_FORMAT, PRICES, inDollars, mapPrice } from "./billing/prices";
import { origin, prefixForHost } from "./http";
import type { Env } from "./types";
import { DEFAULT_LIMITS } from "./agent/request";

/** What the page claims to be, in the words somebody would search for. */
const TITLE = "Oassis — Web Infrastructure for AI Agents";
const DESCRIPTION =
  "Search, scrape, crawl and control a browser through one API. " +
  "Delegate research through the Task API, connect via MCP or use HTTP endpoints with x402.";

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
        `<tr><td>${escape(what)}</td><td class="p">${Number(price.slice(1))/0.002} credits · ${escape(price)}</td><td class="n">${escape(note)}</td></tr>`,
    )
    .join("");

  const tools: [string, string, string, string][] = [
    ["web_scrape", "Read a page or document as markdown, html, links, controls, accessibility, elements, screenshot, pdf or json.", `${inDollars(PER_FORMAT.markdown)} per output`, "Over MCP: credits"],
    ["web_map", "List a site's urls, from its sitemap and optionally the page itself.", inDollars(mapPrice(false)), "Over MCP: credits"],
    ["web_session_open", "Open a real browser on a page and get its map of controls.", `${inDollars(PRICES.sessionOpen)} first minute`, "Over MCP: credits"],
    ["web_act", "Click, type, select, scroll and wait on an open session.", `${inDollars(PRICES.action)} per action`, "Over MCP: credits"],
    ["web_scrape_batch", "Read a list of urls you give it, as a background job.", "one scrape per url", "Over MCP: credits"],
    ["web_crawl", "Follow a site's links and read every page, as a background job.", "per page read", "Over MCP: credits"],
    ["web_batch_status", "Check a batch: status, results, or cancel it.", "free", "Over MCP: credits"],
    ["web_crawl_status", "Check a crawl: pages read, discovered, still queued.", "free", "Over MCP: credits"],
    ["web_session_close", "Close a session and stop browser time.", "free", "Over MCP: credits"],
    ["web_search_exa", "Search the web with Exa's index.", "Exa's price, about $0.007", "Over MCP: credits"],
    ["web_feedback", "Report a result that was wrong.", "free", "Over MCP: credits"],
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
<meta name="twitter:card" content="summary_large_image">
<meta property="og:image" content="${base}/og-image.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Oassis — web infrastructure for AI agents">
<meta property="og:site_name" content="Oassis">
<meta name="twitter:image" content="${base}/og-image.png">
${ICON_LINKS}
<script type="application/ld+json">${jsonLd}</script>
<script type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@graph":[{"@type":"WebSite",name:"Oassis",url:"https://oassis.dev/"},{"@type":"Organization",name:"Oassis",url:"https://oassis.dev/",logo:"https://oassis.dev/icon-512.png"}]})}</script>
${STYLE}
${LANDING_STYLE}
<style>
.task-section { color:#102d42 }
.task-heading {display:flex;align-items:start;gap:32px;justify-content:space-between}
.task-heading>div {max-width:740px}.task-heading .button{flex-shrink:0;margin-top:30px}
.task-kicker {color:#2458c8;font-weight:600;margin-bottom:8px}.task-heading h2{font-size:clamp(30px,4vw,46px);border:0;margin:0 0 18px;line-height:1.15;letter-spacing:-.03em}
.task-levels {display:grid;grid-template-columns:1fr 1fr;margin:0 0 24px;border-left:4px solid #2458c8;background:#e5eef3}
.task-levels>div{padding:18px 24px}.task-levels span{display:block;color:#526879;font-size:14px}
.task-demo {display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);border:1px solid #c9dae3;border-radius:14px;overflow:hidden;background:white}
.task-request{padding:26px;min-width:0}.task-demo-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}.task-demo-top h3{margin:0}
.task-transport{padding:7px 12px;border:1px solid #c9dae3;background:white;color:#102d42;cursor:pointer;font:inherit}.task-transport[aria-pressed="true"]{background:#102d42;color:white}
.oassis-home .task-request pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#102d42;color:#e5f2fa;font-size:13px;line-height:1.65}.task-request pre[hidden]{display:none}
.task-result{background:#e5eef3;padding:26px}.task-result .demo-label{display:inline-block}.task-result h3{font-size:26px;margin:20px 0}.task-result ol{padding-left:22px}.task-result li{padding:8px 0}.task-result li span{display:block;color:#526879}.task-result>p:not(.demo-label){font-size:14px;color:#526879}
.task-operations{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;padding:10px 0 20px}.task-operations code{font-size:12px;overflow-wrap:anywhere}.task-operations p{font-size:13px;margin:10px 0}.task-billing{font-size:14px;color:#526879;border-top:1px solid #c9dae3;padding-top:20px}.task-billing strong{color:#102d42}
.site-nav{flex-wrap:wrap;gap:18px}.site-nav nav{flex-wrap:wrap}
@media(max-width:800px){.task-heading{display:block}.task-heading .button{margin:0 0 22px}.task-demo{grid-template-columns:1fr}.task-levels{grid-template-columns:1fr}.task-operations{grid-template-columns:1fr;gap:0}.task-request,.task-result{padding:20px}}
</style>
</head>
<body class="oassis-home">
<a class="skip-link" href="#main">Skip to content</a>
<div class="wrap">
<header class="site-nav"><a class="brand" href="/" aria-label="oassis home"><img src="/favicon.svg" alt="" width="35" height="35">oassis</a><nav aria-label="Main navigation"><a href="#tools">Web Tools</a><a href="#task-api">Tasks</a><a href="/docs">Docs</a><a class="nav-reference" href="${api}/openapi.json">API reference</a><a class="nav-pricing" href="#pricing">Pricing</a><a href="/login">Log In</a><a class="nav-connect" href="/signup">Sign Up</a></nav></header>
<main id="main">
<section class="launch" id="tools" aria-labelledby="hero-title">
<div class="launch-top"><h1 id="hero-title">Give your agent<br>the web to work with.</h1><div class="launch-copy"><p>Find the right page. Read what matters. Open a browser and take the next step. Web infrastructure for AI agents, through one API.</p><div class="launch-actions"><a class="button" href="#try">Connect via MCP</a><a class="button secondary" href="/docs">Explore the API</a></div><p class="connection-note">Try MCP with 100 credits. Sign up for 1,000 welcome credits and create your API key.</p></div></div>
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
<section class="content-section task-section" id="task-api" aria-labelledby="task-title">
<div class="task-heading"><div><p class="task-kicker">Tasks</p><h2 id="task-title">Give your agent a research task.</h2><p class="section-lead">Describe what you need to find out. Oassis searches and reads public pages, then returns an answer with sources. Track progress or cancel the task while it runs.</p></div><a class="button" href="/task-api">View Tasks documentation</a></div>
<div class="task-levels" aria-label="Two levels of web access"><div><strong>Delegate the research</strong><span>Task: plan, search, read and synthesize</span></div><div><strong>Control each operation</strong><span>Web tools: search, scrape, crawl, browser and act</span></div></div>
<div class="task-demo"><div class="task-request"><div class="task-demo-top"><h3>Start a task</h3><div role="group" aria-label="Task example transport"><button type="button" class="task-transport" data-task-transport="http" aria-pressed="true" aria-controls="task-http">HTTP</button><button type="button" class="task-transport" data-task-transport="mcp" aria-pressed="false" aria-controls="task-mcp">MCP</button></div></div>
<pre id="task-http"><code>POST ${api}/agent/v1/tasks
Content-Type: application/json

{
  "task": "Read this public pricing page and summarize the plans with source links.",
  "mode": "research",
  "urls": ["https://oassis.dev/"],
  "limits": {
    "max_cost_usd": ${DEFAULT_LIMITS.max_cost_usd},
    "max_duration_seconds": ${DEFAULT_LIMITS.max_duration_seconds},
    "max_steps": ${DEFAULT_LIMITS.max_steps}
  }
}</code></pre>
<pre id="task-mcp" hidden><code>web_task_start
{
  "task": "Read this public pricing page and summarize the plans with source links.",
  "mode": "research",
  "urls": ["https://oassis.dev/"]
}

web_task_status
{ "id": "TASK_ID", "access_token": "TASK_TOKEN" }

web_task_cancel
{ "id": "TASK_ID", "access_token": "TASK_TOKEN" }</code></pre>
<p class="muted">Illustrative request. No requests are sent. Start returns a task ID and an <code>access_token</code>; keep both for status and cancellation.</p></div>
<div class="task-result"><p class="demo-label">Illustrative lifecycle</p><h3>Follow the work.</h3><ol><li><strong>Queued</strong><span>The task is ready to run.</span></li><li><strong>Running</strong><span>Search, read sources and prepare the answer.</span></li><li><strong>Result</strong><span>Inspect the answer, source links and any missing evidence.</span></li></ol><p>Research can finish with a partial answer when evidence is missing. Check the returned status and result.</p><p class="muted">Task currently supports public-page research. Use the web tools below to orchestrate crawling or browser actions yourself.</p></div></div>
<div class="task-operations"><div><h3>Start</h3><code>POST /agent/v1/tasks</code><p>MCP: <code>web_task_start</code></p></div><div><h3>Status</h3><code>GET /agent/v1/tasks/{id}</code><p>MCP: <code>web_task_status</code></p></div><div><h3>Cancel</h3><code>POST /agent/v1/tasks/{id}/cancel</code><p>MCP: <code>web_task_cancel</code></p></div></div>
<p class="task-billing"><strong>MCP: API key and credits; reserve maximum budget and settle actual cost.</strong> HTTP/x402: creation charges the selected execution budget upfront (${escape(inDollars(DEFAULT_LIMITS.max_cost_usd * 1_000_000))} by default). Status and cancellation are free with <code>Task-Token</code>. No automatic on-chain refund of unused budget.</p>
</section>
<section class="content-section" id="tool-catalog">
<h2>Individual tool reference</h2>
<p class="section-lead">Build your own workflow, one operation at a time. Search, read pages, crawl websites and control a browser.</p>

<p>Use an API key with shared credits over MCP or HTTP, or pay each HTTP call with x402.</p>

<div class="grid">${toolCards}</div>

</section>
<section class="content-section">
<h2>From a page to the next action.</h2>

<div class="grid">
  <div class="card"><h3>Read any page</h3><p>Markdown, html, links and a map of every control, in one call. A PDF, Word, Excel or CSV url comes back as markdown without a browser.</p></div>
  <div class="card"><h3>Act on the page</h3><p>Open a session and it stays open: look, click, type, look again. The control references keep working between calls.</p></div>
  <div class="card"><h3>Pay only per call</h3><p>Prices start at ${escape(inDollars(PER_FORMAT.markdown))}. HTTP calls use x402 wallet payments, without an account. MCP uses credits: a 100-credit trial for scrape and map, then an API key.</p></div>
</div>

</section>
<section class="content-section" id="try">
<h2>Connect once. Put the web to work.</h2>
<div class="connect-panel"><h3>Connect through MCP</h3><p>Point your MCP client at <code>${api}/mcp</code>. Try scrape and map with 100 credits without an account. Create an API key for further use and all other tools.</p><pre><code>claude mcp add --transport http oassis ${api}/mcp</code></pre><button class="button" type="button" id="copy-mcp">Copy MCP URL</button><p id="copy-status" class="muted" role="status"></p></div>
<h3>Or call the HTTP API</h3>

<p>An unpaid request answers <code>402</code> with the exact price of that call. The agent signs
a USDC payment on Base from its own wallet and repeats the request. No account, no human in
the loop, and the facilitator pays the gas.</p>

<pre><code>curl -X POST ${api}${prefix}/scrape \
  -H 'content-type: application/json' \
  -d '{"url":"https://oassis.dev","formats":["markdown","controls"]}'</code></pre>

<p>That answers <code>402</code> with the price of that call. Pay it with a wallet and repeat the
request. No account or API key is required.</p>

<h3>MCP trial and API keys</h3>

<p>MCP includes 100 trial credits for scrape and map. Use an API key for search, browser tools and research tasks.</p>

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
<section class="content-section" aria-labelledby="guides-title"><h2 id="guides-title">Build with the web.</h2><p class="muted">Practical guides for the next step in your agent's workflow.</p><div class="grid">
<div class="card"><h3><a href="/task-api">Tasks</a></h3><p>Start public-page research, track progress and inspect answers with sources.</p></div>
<div class="card"><h3><a href="/web-scraping-api">Web scraping API</a></h3><p>Turn pages and documents into Markdown, links and structured data.</p></div>
<div class="card"><h3><a href="/web-crawling-api">Web crawling API</a></h3><p>Discover a site, set a page budget and collect a bounded crawl.</p></div>
<div class="card"><h3><a href="/browser-api">Browser sessions and actions</a></h3><p>Inspect controls and work through a page without losing its state.</p></div>
<div class="card"><h3><a href="/mcp">Connect through MCP</a></h3><p>Discover tools and connect a remote MCP-compatible client.</p></div>
<div class="card"><h3><a href="/x402">Pay with x402</a></h3><p>Read a quote and authorize an HTTP request using a wallet.</p></div>
<div class="card"><h3><a href="/use-cases">Agent use cases</a></h3><p>Build research, retrieval and monitoring around observed web data.</p></div>
</div></section>
<section class="content-section" id="pricing">
<h2>Explicit prices for each level.</h2>
<div class="grid">${CREDIT_PACKAGES.map(pack=>`<div class="card"><h3>$${pack.cents/100} · ${pack.credits.toLocaleString('en-US')} credits</h3><p>1 credit = $0.002. A basic page costs 1 credit. Buy once or monthly; purchased credits accumulate and do not expire.</p><a class="button" href="/dashboard/billing">Get credits</a></div>`).join('')}</div><p>Start with 100 trial credits over MCP for scrape and map. Create a verified account for 1,000 welcome credits once, and generate your API key. Card purchases require Stripe activation.</p>
<p><strong>Task API:</strong> MCP has a 100-credit trial for scrape and map; other paid tools require an API key. HTTP task creation charges a fixed execution package, ${escape(inDollars(DEFAULT_LIMITS.max_cost_usd * 1_000_000))} by default. <a href="#task-api">See Task access and pricing</a>.</p>
<h3>Web tools over HTTP</h3>

<table><tbody>${rows}</tbody></table>

<p class="muted">Priced per call, quoted before any work happens. A wallet payment is settled
on-chain; tasks use a fixed execution budget with no automatic on-chain refund.</p>

</section>
<section class="content-section">
<h2>A few things to know.</h2>
<p class="section-lead">Choose the right level of control, understand access and pricing, and know what to expect from a result.</p>
<h3>Getting started</h3>
<details><summary>What is Oassis?</summary><p>Web infrastructure for AI agents and applications. Use individual tools to search, read and crawl public content or interact with a browser. Use Tasks to delegate public-page research and receive an answer with sources.</p></details>
<details><summary>What is the difference between Web Tools and Tasks?</summary><p>Web Tools let your application choose each operation and build its own workflow. Tasks take a research question, plan the work, search and read public pages, then synthesize an answer. <a href="/docs">Compare the two approaches in Docs</a>.</p></details>
<details><summary>Which one should I use?</summary><p>Choose Web Tools for page imports, datasets or workflows where you need control over every step. Choose Tasks when you want to delegate a research question and follow its progress rather than implement the research loop yourself.</p></details>
<details><summary>Do I need an account or an API key?</summary><p>Scrape and map include a 100-credit MCP trial. Further use and other paid tools require an API key and credits. Paid HTTP operations use a wallet and x402. A Task access token lets you follow one task; it is not an account or general API key.</p></details>
<details><summary>Can I use Oassis without writing code?</summary><p>You can connect Oassis to a compatible MCP client and ask that client to use its tools. Your client needs support for remote HTTP MCP servers. Oassis currently provides APIs and an MCP server; a standalone web research assistant is not yet available.</p></details>
<h3>Access and pricing</h3>
<details><summary>What is MCP?</summary><p>The Model Context Protocol lets AI clients discover and call external tools. Configure <code>${api}/mcp</code> in a compatible client. <a href="/mcp">See the connection guide</a>.</p></details>
<details><summary>How many free credits do I get?</summary><p>MCP includes 100 trial credits for scrape and map. Search, Tasks and browser tools require an API key with sufficient credits. Parameters such as a crawl page count or task execution budget define one job; they are not daily usage allowances. Reads respect robots.txt.</p></details>
<details><summary>Which clients work with it?</summary><p>Clients that support remote HTTP MCP servers can discover Oassis tools. Applications can also call the HTTP API using an x402-capable client. Your client decides when to invoke a tool; connecting Oassis does not automatically route every web request through it.</p></details>
<details><summary>What is x402?</summary><p>An HTTP payment protocol. A request without payment receives a <code>402</code> challenge describing the price. The client signs a USDC payment on Base and retries the request. No Oassis account or API key is required. <a href="/x402">Read the payment guide</a>.</p></details>
<details><summary>How much do Web Tools cost?</summary><p>Status and cancellation are free for the owning account. HTTP Markdown extraction starts at ${escape(inDollars(PER_FORMAT.markdown))} per requested output. Formats, rendering, browser time and the operation determine the price. HTTP search passes through the search provider's price. Read the <code>402</code> quote for the exact request.</p></details>
<details><summary>How are Tasks priced?</summary><p>Tasks over MCP require an API key and sufficient credits. HTTP creation charges the selected execution package upfront, using <code>limits.max_cost_usd</code> (${escape(inDollars(DEFAULT_LIMITS.max_cost_usd * 1_000_000))} by default). Status and cancellation are free with the task token. There is no automatic on-chain refund of unused budget.</p></details>
<details><summary>Does a 402 response mean my request ran?</summary><p>No. A payment challenge is not an execution result or proof of payment. Use an x402-capable client to authorize payment and retry. Inspect the final response, and for background jobs follow the returned identifier through the status operation.</p></details>
<details><summary>Am I charged when something fails?</summary><p>Status and cancellation are free for the owning account. HTTP payment and execution are separate parts of the request: inspect the response and payment receipt when troubleshooting. For Tasks, the selected package is charged upfront and a failed, partial or cancelled result does not trigger an automatic on-chain refund.</p></details>
<h3>Research tasks</h3>
<details><summary>What can a Task do today?</summary><p>Research public pages: plan, search, read and synthesize an answer with source links. You can provide up to five starting URLs. Tasks currently do not orchestrate site crawling, persistent browser sessions or browser actions; use Web Tools to build those workflows.</p></details>
<details><summary>How do I start a Task and get the result?</summary><p>Use <code>web_task_start</code> over MCP or <code>POST /agent/v1/tasks</code> over HTTP. Keep the returned ID and <code>access_token</code>. Follow progress with <code>web_task_status</code> or <code>GET /agent/v1/tasks/{id}</code>, sending <code>Task-Token</code> for HTTP. <a href="/task-api">See all Task examples</a>.</p></details>
<details><summary>Can I cancel a Task?</summary><p>Yes. Use <code>web_task_cancel</code> with the ID and access token, or <code>POST /agent/v1/tasks/{id}/cancel</code> with the <code>Task-Token</code> header. Cancellation requests the task to stop; inspect its status to confirm the outcome. HTTP cancellation does not automatically refund the package.</p></details>
<details><summary>What does a partial research result mean?</summary><p>The research could not establish everything requested from the available evidence. Check the result's sources and missing evidence before using the answer. Refine the question or provide more relevant public URLs for another task.</p></details>
<h3>Web content and browser workflows</h3>
<details><summary>Which output formats can I request?</summary><p>Depending on the tool, page outputs include Markdown, HTML, links, controls, accessibility, elements, screenshots, PDF and structured JSON. Select the formats your application needs; multiple HTTP outputs can add to the price. <a href="/web-scraping-api">See extraction examples</a>.</p></details>
<details><summary>Can I read documents as well as web pages?</summary><p>Supported PDF, Word, Excel and CSV URLs can be converted to Markdown. The document must be reachable and in a supported format. <a href="/web-scraping-api">Read the scraping guide</a>.</p></details>
<details><summary>Should I use map, crawl or batch?</summary><p>Use map to discover a site's URLs. Use crawl to follow links and read pages as a background job. Use batch when you already have the list of URLs. Keep the job identifier and retrieve its status and results rather than starting the same job again.</p></details>
<details><summary>When do I need a browser session?</summary><p>Use a session when the workflow needs page state or interaction. Open it, inspect the controls, run actions and read the updated state. Close it when finished. Your application chooses and verifies the actions. <a href="/browser-api">See the browser lifecycle</a>.</p></details>
<details><summary>Can Oassis access every website?</summary><p>No. Access restrictions, robots.txt, anti-bot systems, unsupported content and page changes can prevent retrieval or interaction. A browser does not guarantee access. Inspect errors and source content instead of assuming every requested page was read.</p></details>
<details><summary>Where can I find schemas and integration examples?</summary><p>Start with <a href="/docs">Docs</a>, use the <a href="/task-api">Tasks guide</a> for research, and consult the <a href="${api}/openapi.json">OpenAPI reference</a> for HTTP schemas. MCP clients can discover tool parameters through <code>tools/list</code>.</p></details>

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
  document.querySelectorAll('[data-task-transport]').forEach(function (button) {
    button.addEventListener('click', function () {
      document.querySelectorAll('[data-task-transport]').forEach(function (tab) { tab.setAttribute('aria-pressed', String(tab === button)); });
      ['http', 'mcp'].forEach(function (transport) { document.getElementById('task-' + transport).hidden = transport !== button.dataset.taskTransport; });
    });
  });
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
  const site = ["oassis.dev", "www.oassis.dev"].includes(new URL(base).hostname);
  const urls = site
    ? ["/", "/docs", "/task-api", "/web-scraping-api", "/web-crawling-api", "/browser-api", "/mcp", "/x402", "/use-cases", "/privacy", "/terms", "/support"]
    : ["/privacy", "/terms", "/support"];
  // Keep the exported two-argument interface used by the text renderer.
  void prefix;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${base}${u === "/" ? "/" : u}</loc></url>`).join("\n")}
</urlset>
`;
}
