/** Public pages for the Agents section: an index and one page per service, for linking from ads. */
import type { Hono } from "hono";
import type { Env } from "../types";
import { AGENT_INFO, AGENT_NAMES, agentSchemas, type AgentName } from "./catalog";

const SITE = "https://oassis.dev";
const API = "https://api.oassis.dev";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const COPY: Record<AgentName, { path: string; title: string; description: string; intro: string; uses: string[] }> = {
  "price-watch": {
    path: "/agents/price-watch",
    title: "Price watch agent: track product prices automatically",
    description: "Free price watch agent. Add product URLs, choose how often to check, and get a report of price changes and drops. No prompt needed.",
    intro: "Add the product pages you want to follow. The agent reads them on schedule, extracts the price and reports each change and each drop above your threshold.",
    uses: ["Competitor prices and promotions", "Your own product pages after supplier changes", "Marketplace listings you resell"],
  },
  "web-watch": {
    path: "/agents/web-watch",
    title: "Web change agent: know when a page changes",
    description: "Free web change agent. Watch any public page and get a report of what was added or removed, filtered by keyword.",
    intro: "Give the agent public pages and, optionally, keywords that matter. It reports what changed since the last read, and ignores changes that do not touch your keywords.",
    uses: ["Terms, policies and legal notices", "Job boards, tenders and calls for applications", "Documentation and release notes"],
  },
  "competitor-monitor": {
    path: "/agents/competitor-monitor",
    title: "Competitor monitor agent: see what your rivals publish",
    description: "Free competitor monitor agent. Watch a competitor's pricing, blog and changelog pages and get a summary of what changed.",
    intro: "Give the agent a competitor's domain and the sections to follow. It reads them on schedule and reports what changed: new prices, new posts, new releases.",
    uses: ["Pricing and plan changes", "New blog posts and product announcements", "Changelog and feature releases"],
  },
};

function parameterTable(name: AgentName): string {
  const rows = Object.entries(agentSchemas[name].shape).map(([key, value]) => {
    const description = (value as { description?: string }).description ?? "";
    return `<tr><td><code>${esc(key)}</code></td><td>${esc(description)}</td></tr>`;
  });
  return `<table><thead><tr><th>Parameter</th><th>What it does</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function example(name: AgentName): string {
  const body: Record<AgentName, object> = {
    "price-watch": { urls: ["https://example.com/product"], frequency: "daily", alert_drop_percent: 5 },
    "web-watch": { urls: ["https://example.com/pricing"], frequency: "daily", keywords: ["price", "plan"] },
    "competitor-monitor": { domain: "https://example.com", sections: ["/pricing", "/blog"], frequency: "weekly" },
  };
  return `curl -i -X POST ${API}/agents/v1/${name} \\
  -H 'Authorization: Bearer YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(body)}'`;
}

function layout(title: string, description: string, path: string, body: string): string {
  const url = SITE + path;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${url}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><meta property="og:type" content="website">
<meta name="robots" content="index,follow">
<style>
:root{color-scheme:light dark;--fg:#0f172a;--muted:#475569;--bg:#f8fafc;--card:#ffffff;--line:#e2e8f0;--accent:#0f766e}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--fg:#e2e8f0;--muted:#94a3b8;--bg:#0b1020;--card:#111827;--line:#1f2937;--accent:#2dd4bf}}
:root[data-theme="dark"]{--fg:#e2e8f0;--muted:#94a3b8;--bg:#0b1020;--card:#111827;--line:#1f2937;--accent:#2dd4bf}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
header,footer{padding:16px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)}
footer{border-top:1px solid var(--line);border-bottom:0;color:var(--muted);font-size:14px}
header a,footer a{color:var(--fg);text-decoration:none}
main{max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:30px;line-height:1.2;margin:8px 0}h2{font-size:20px;margin:28px 0 8px}
.intro{color:var(--muted);font-size:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
a{color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;font-size:13px}
.cta{display:inline-block;background:var(--accent);color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px}
@media (max-width:600px){main{padding:16px}h1{font-size:26px}}
</style></head><body>
<header><a href="/"><strong>oassis</strong></a><nav aria-label="Main"><a href="/#web-tools">Web Tools</a><a href="/task-api">Web Tasks</a><a href="/agents">Agents</a><a href="/docs">Docs</a><a href="/login">Log In</a></nav></header>
<main>${body}</main>
<footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="${API}/openapi.json">API reference</a></footer>
</body></html>`;
}

function servicePage(name: AgentName): string {
  const c = COPY[name];
  const info = AGENT_INFO[name];
  const body = `<h1>${esc(info.title)}</h1><p class="intro">${esc(c.intro)}</p>
<p><a class="cta" href="#api">Use it through the API</a> <span style="color:var(--muted)">Free. Needs a free account API key.</span></p>
<h2>Good for</h2><ul>${c.uses.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>
<h2>What you configure</h2><p>No prompt. Choose the pages, the frequency and the thresholds. The agent does the rest.</p>
${parameterTable(name)}
<h2 id="api">Create the service</h2><pre><code>${esc(example(name))}</code></pre>
<p>The service runs on its schedule. Each run compares the page with its previous read and keeps the report. Read the latest report with <code>GET ${API}/agents/v1/services/SERVICE_ID</code> and stop it with <code>POST ${API}/agents/v1/services/SERVICE_ID/cancel</code>.</p>
<h2>List and cancel your services</h2><pre><code>${esc(`curl ${API}/agents/v1/services -H 'Authorization: Bearer YOUR_API_KEY'
curl -X POST ${API}/agents/v1/services/SERVICE_ID/cancel -H 'Authorization: Bearer YOUR_API_KEY'`)}</code></pre><p>Cancellation stops future runs and keeps your latest report. A read already in progress may finish. Repeating cancellation is safe.</p><h2>Limits</h2><p>Each service reads up to 10 public pages per run. An account can have 10 active services. Pages that block automated reads are reported as errors, not skipped silently.</p>
<h2>Other agents</h2><div class="grid">${AGENT_NAMES.filter((n) => n !== name).map((n) => `<div class="card"><a href="${COPY[n].path}"><strong>${esc(AGENT_INFO[n].title)}</strong></a><p style="margin:6px 0 0;color:var(--muted)">${esc(AGENT_INFO[n].summary)}</p></div>`).join("")}</div>`;
  return layout(c.title, c.description, c.path, body);
}

function indexPage(): string {
  const cards = AGENT_NAMES.map((n) => `<div class="card"><a href="${COPY[n].path}"><strong>${esc(AGENT_INFO[n].title)}</strong></a><p style="color:var(--muted);margin:6px 0">${esc(AGENT_INFO[n].summary)}</p><p style="margin:0"><a href="${COPY[n].path}">Open the agent</a></p></div>`).join("");
  const body = `<h1>Agents that work on schedule</h1><p class="intro">Choose an agent, set its parameters, and it runs on schedule. No prompt, no code. Each one is free to use with an Oassis account key.</p><div class="grid">${cards}</div>
<h2>How it works</h2><ol><li>Choose the agent and set its parameters.</li><li>Create the service with one API call.</li><li>Read each run's report: what changed, and what to look at.</li></ol>`;
  return layout("Oassis agents: price, web change and competitor monitoring", "Free agents that watch prices, web pages and competitors on schedule and report what changed. Configure them, no prompt needed.", "/agents", body);
}

export function mountAgentPages(app: Hono<{ Bindings: Env }>): void {
  app.get("/agents", (c) => c.html(indexPage()));
  for (const name of AGENT_NAMES) {
    app.get(COPY[name].path, (c) => c.html(servicePage(name)));
  }
}
