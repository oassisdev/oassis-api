import { WEB_CATALOG } from "./product-catalog";
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
import { CREDIT_MICROS, CREDIT_PACKAGES } from "./billing/credits";
import { PRICES, crawlPagePrice, inDollars, mapPrice, scrapePrice } from "./billing/prices";
import { DEFAULT_LIMITS, MAX_LIMITS, MIN_COST_USD } from "./agent/request";
import { origin, prefixForHost } from "./http";
import type { Env } from "./types";

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

/** One row of an API table: the MCP tool name, the HTTP route, and what it does. "-" when there is none. */
type ApiRow = [string, string, string];

const apiTable = (rows: ApiRow[]) =>
  `<table><thead><tr><th>MCP tool</th><th>HTTP route</th><th>What it does</th></tr></thead><tbody>${rows
    .map(([tool, route, what]) => `<tr><td><code>${escape(tool)}</code></td><td><code>${escape(route)}</code></td><td>${escape(what)}</td></tr>`)
    .join("")}</tbody></table>`;

const productRows = (family: 'web' | 'tasks'): ApiRow[] => WEB_CATALOG.filter(op => op.family === family).map(op => [op.mcp, op.method + ' ' + op.path, op.description]);
const WEB_TOOLS = productRows('web');
const WEB_TASKS = productRows('tasks');

const AGENTS: ApiRow[] = [
  ["-", "GET /agents/v1/price-watch", "Price watch: reads product pages on your schedule and reports price changes and drops."],
  ["-", "GET /agents/v1/web-watch", "Web change watch: reports what was added or removed on a page, optionally filtered by keyword."],
  ["-", "GET /agents/v1/competitor-monitor", "Competitor monitor: watches a competitor's pricing, blog and changelog and reports what changed."],
];

const AGENT_MANAGEMENT: ApiRow[] = [
  ["-", "GET /agents/v1", "List the scheduled agents and how to create them."],
  ["-", "POST /agents/v1/:agent", "Create a scheduled agent from its name. Needs a free account key."],
  ["-", "GET /agents/v1/services", "List your agent services. Needs an account key."],
  ["-", "GET /agents/v1/services/:id", "Read one service: its state and its last report."],
  ["-", "POST /agents/v1/services/:id/cancel", "Cancel a service. Its last report is kept."],
];

/** The three reference sections after the claim: every Web Tool, every Task, every Agent, by name. */
const apiSections = () => `<section class="content-section" id="web-tools" aria-labelledby="web-tools-title">
<h2 id="web-tools-title">Web Tools</h2>
<p class="section-lead">Synchronous. Each request returns its result in the same response.</p>
${apiTable(WEB_TOOLS)}
</section>
<section class="content-section" id="web-tasks" aria-labelledby="web-tasks-title">
<h2 id="web-tasks-title">Web Tasks</h2>
<p class="section-lead">Asynchronous. Creating a job returns an id; follow that id for progress and results. Research is a task too.</p>
${apiTable(WEB_TASKS)}
</section>
<section class="content-section" id="agents" aria-labelledby="agents-title">
<h2 id="agents-title">Agents</h2>
<p class="section-lead">Scheduled agents that watch pages for you and report what changed. Free, with a free account key.</p>
${apiTable(AGENTS)}
<h3>Managing agents</h3>
${apiTable(AGENT_MANAGEMENT)}
</section>`;

/**
 * The price of each operation, from the same numbers the API charges. Over MCP a call costs
 * credits (1 credit = $0.002); over HTTP it costs the x402 amount shown.
 */
const credits = (micros: number) => (micros / CREDIT_MICROS).toLocaleString("en-US", { maximumFractionDigits: 2 });
const usd = (micros: number) => inDollars(micros);
const PRICE_ROWS: [string, string, string, string][] = [
  ["Read a page or a document, one output", "Trial over MCP", credits(scrapePrice(["markdown"])), usd(scrapePrice(["markdown"]))],
  ["Read a page as JSON", "Trial over MCP", credits(scrapePrice(["json"])), usd(scrapePrice(["json"]))],
  ["Read from the cache", "No", credits(PRICES.cacheHit), usd(PRICES.cacheHit)],
  ["List a site's urls (sitemap)", "Trial over MCP", credits(mapPrice(false)), usd(mapPrice(false))],
  ["List a site's urls, including the page", "Trial over MCP", credits(mapPrice(true)), usd(mapPrice(true))],
  ["Search the web", "No", credits(7_000), "about $0.007 (provider price)"],
  ["Open a browser session", "No", credits(PRICES.sessionOpen), usd(PRICES.sessionOpen)],
  ["Act on an open session, per action", "No", credits(PRICES.action), usd(PRICES.action)],
  ["Each extra minute of browser time", "No", credits(PRICES.sessionMinute), usd(PRICES.sessionMinute)],
  ["Batch: per url read", "No", credits(scrapePrice(["markdown"])), usd(scrapePrice(["markdown"]))],
  ["Crawl: per page read", "No", credits(crawlPagePrice(["markdown"])), usd(crawlPagePrice(["markdown"]))],
  ["Research task, fixed budget (default)", "No", credits(DEFAULT_LIMITS.max_cost_usd * 1_000_000), usd(DEFAULT_LIMITS.max_cost_usd * 1_000_000)],
  ["Research task, smallest and largest budget", "No", `${credits(MIN_COST_USD * 1_000_000)} to ${credits(MAX_LIMITS.max_cost_usd * 1_000_000)}`, `${usd(MIN_COST_USD * 1_000_000)} to ${usd(MAX_LIMITS.max_cost_usd * 1_000_000)}`],
  ["Status, cancellation, feedback, closing a session, account", "Free", "0", "Free"],
  ["Scheduled agents", "Free with a free account key", "-", "-"],
];

const priceTable = () => `<table><thead><tr><th>Operation</th><th>Free?</th><th>Credits, with an API key</th><th>Over HTTP, x402</th></tr></thead><tbody>${PRICE_ROWS
  .map(([op, free, cr, http]) => `<tr><td>${escape(op)}</td><td>${escape(free)}</td><td>${escape(cr)}</td><td>${escape(http)}</td></tr>`)
  .join("")}</tbody></table>`;

/** The pricing section: what is free, what needs an API key, and what each operation costs. */
const pricingSection = () => `<section class="content-section" id="pricing" aria-labelledby="pricing-title">
<h2 id="pricing-title">Pricing</h2>
<p class="section-lead">Status, cancellation and account are free. A trial of 100 credits covers scrape and map over MCP. Everything else needs an API key with credits, or an x402 payment over HTTP.</p>
<p>1 credit = $0.002. Credits come in three packs: ${CREDIT_PACKAGES.map((pack) => `$${pack.cents / 100} for ${pack.credits.toLocaleString("en-US")} credits`).join(", ")}. Purchased credits do not expire.</p>
${priceTable()}
<p class="muted">Prices are quoted per call before any work happens. A research task reserves its budget and charges what it actually used; with HTTP/x402, the budget is charged as a fixed package. HTTP with an API key uses the same reserve and actual-cost settlement as MCP.</p>
</section>`;

/** The questions a reader asks before signing up, in the order they ask them. */
const FAQS: [string, string][] = [
  ["What is Oassis?", "Web infrastructure for AI agents. Search, read, crawl and control a browser through one API, delegate research to Tasks, and run scheduled Agents."],
  ["What is the difference between Web Tools and Web Tasks?", "Web Tools return an individual operation in the same response. Web Tasks run batch extraction, crawling or research in the background: start a job, follow its progress and collect its results. Research returns an answer with sources."],
  ["Do I need an account or an API key?", "MCP includes 100 trial credits for scrape and map. Other tools, Tasks and scheduled Agents need an account and an API key. HTTP calls can be paid per call with x402, without an account."],
  ["How many free credits do I get?", "100 trial credits over MCP for scrape and map. A verified account gets 1,000 welcome credits once. Purchased credits do not expire."],
  ["What is MCP?", "The Model Context Protocol lets AI clients discover and call tools. Point any MCP-compatible client at https://api.oassis.dev/mcp to use Oassis."],
  ["What is x402?", "An HTTP payment protocol. A request without payment receives a 402 response with the price. The client pays in USDC on Base and retries. No account is needed."],
  ["Can Oassis read every website?", "No. robots.txt, access restrictions, anti-bot systems and page changes can prevent a read. Check the errors and the sources rather than assuming a page was read."],
  ["Are scheduled Agents free?", "Yes, with a free account key. They run daily or weekly, and report what changed."],
];

/** The last section of the home: the questions, each one a closed item that opens on click. */
const faqSection = () => `<section class="content-section" id="faq" aria-labelledby="faq-title">
<h2 id="faq-title">Frequently asked questions</h2>
${FAQS.map(([q, a]) => `<details><summary>${escape(q)}</summary><p>${escape(a)}</p></details>`).join("\n")}
</section>`;

/** The system claim uses the hero's own styles; this only adds the line of parts. */
const CLAIM_STYLE = `<style>
.launch .claim-lines p { margin:0 0 6px }
.launch .claim-part { color:#e9ad45; font-weight:700 }
.oassis-home .header-links { display:flex; align-items:center; gap:24px; font-weight:600 }
.oassis-home .header-links a { color:#102d42 }
.oassis-home .header-links .sign-up { color:#fff }
</style>`;

/** The footer: the copyright on the left, the legal links spaced out on the right. */
const FOOTER_STYLE = `<style>
.oassis-home .site-footer { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px 32px; margin-top:24px; padding:24px 0; border-top:1px solid #c9dae3; color:#526879; font-size:14px; line-height:1.6 }
.oassis-home .site-footer p { margin:0 }
.oassis-home .site-footer nav { display:flex; flex-wrap:wrap; gap:24px }
.oassis-home .site-footer a { color:#2458c8 }
</style>`;

/** The two account options. Log In is an outlined box; Sign Up is filled, so they never look alike. */
const ACCOUNT_OPTION_STYLE = `<style>
.oassis-home .log-in { display:inline-block; padding:8px 16px; border:2px solid #102d42; border-radius:7px; background:transparent; color:#102d42; font-weight:700; text-decoration:none }
.oassis-home .sign-up { display:inline-block; padding:9px 16px; border:2px solid #102d42; border-radius:7px; background:#102d42; color:#fff; font-weight:700; text-decoration:none }
.oassis-home .profile { display:inline-flex; flex-direction:column; align-items:flex-end; padding:6px 14px; border:2px solid #102d42; border-radius:7px; color:#102d42; font-weight:700; text-decoration:none; line-height:1.25 }
.oassis-home .profile span { font-size:12px; font-weight:400; color:#526879; overflow-wrap:anywhere }
</style>`;

/** Signed out: Log In and Sign Up. Signed in: Profile, with the account's email under it. */
const headerAccount = (account: { email: string } | null) =>
  account
    ? `<nav aria-label="Account"><a class="profile" href="/dashboard">Profile<span>${escape(account.email)}</span></a></nav>`
    : `<nav aria-label="Account"><a class="log-in" href="/login">Log In</a><a class="sign-up" href="/signup">Sign Up</a></nav>`;

/**
 * The home page: the brand and the account option in its header. Its title and description
 * stay for search engines. The page differs by session, so the Worker must not share it.
 */
export function landing(c: Context<{ Bindings: Env }>, account: { email: string } | null = null): string {
  const base = origin(c);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(TITLE)}</title>
<meta name="description" content="${escape(DESCRIPTION)}">
<link rel="canonical" href="${base}/">
${ICON_LINKS}
${STYLE}
${LANDING_STYLE}
${ACCOUNT_OPTION_STYLE}
${CLAIM_STYLE}
${FOOTER_STYLE}
</head>
<body class="oassis-home">
<div class="wrap">
<header class="site-nav"><a class="brand" href="/" aria-label="oassis home"><img src="/favicon.svg" alt="" width="35" height="35">oassis</a><div class="header-links"><nav aria-label="Main"><a href="/#web-tools">Web Tools</a><a href="/#web-tasks">Web Tasks</a><a href="/#agents">Agents</a><a href="/#faq">FAQ</a></nav>${headerAccount(account)}</div></header>
<section class="launch claim" aria-labelledby="claim-title">
<div class="launch-top"><h1 id="claim-title">The web, for<br>your agents.</h1><div class="launch-copy"><div class="claim-lines"><p><span class="claim-part">Web Tools</span> for each step.</p><p><span class="claim-part">Web Tasks</span> for background jobs and research.</p><p><span class="claim-part">Agents</span> that watch pages on a schedule.</p></div><div class="launch-actions"><a class="button" href="/mcp">Connect via MCP</a><a class="button secondary" href="/signup">Get Api Key</a></div><p class="connection-note">Try MCP with 100 credits. Sign up for 1,000 welcome credits and create your API key.</p></div></div>
</section>
${apiSections()}
${pricingSection()}
${faqSection()}
<footer class="site-footer"><p>© ${new Date().getUTCFullYear()} Oassis</p><nav aria-label="Legal"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/privacy#cookies">Cookies</a></nav></footer>
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
    const prefix = "/web/v1";
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
    ? ["/", "/docs", "/task-api", "/web-scraping-api", "/web-crawling-api", "/browser-api", "/mcp", "/x402", "/use-cases", "/privacy", "/terms"]
    : ["/privacy", "/terms"];
  // Keep the exported two-argument interface used by the text renderer.
  void prefix;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${base}${u === "/" ? "/" : u}</loc></url>`).join("\n")}
</urlset>
`;
}
