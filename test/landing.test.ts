import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { landing, robotsTxt, sitemapXml } from "../src/landing";
import { WEB_CATALOG } from "../src/product-catalog";
import { PRICES, inDollars } from "../src/billing/prices";
import type { Env } from "../src/types";

function ctx(host = "oassis.dev"): Context<{ Bindings: Env }> {
  return {
    req: { url: `https://${host}/`, path: "/" },
    env: { BASE_URL: "https://api.oassis.dev" },
  } as unknown as Context<{ Bindings: Env }>;
}

describe("the home page, emptied", () => {
  const html = landing(ctx());

  it("keeps what a search engine reads at the top", () => {
    expect(html).toMatch(/<title>[^<]*Web Scraping[^<]*<\/title>/i);
    expect(html).toMatch(/<meta name="description" content="[^"]{80,}"/);
    expect(html).toContain('<link rel="canonical" href="https://oassis.dev/">');
  });

  it("shows the brand and keeps the playground below Web Tools", () => {
    expect(html).toContain('<a class="brand" href="/" aria-label="oassis home">');
    expect(html).toContain('<main id="main">');
    expect(html.indexOf('id="try-tools"')).toBeGreaterThan(html.indexOf('id="web-tools"'));
    expect(html.indexOf('id="try-tools"')).toBeLessThan(html.indexOf('id="web-tasks"'));
    expect(html).toContain('id="try-scrape-form"');
  });

  it("opens with a claim for the whole system: Web Tools, Tasks and Agents", () => {
    const claim = html.slice(html.indexOf('<section class="launch claim"'), html.indexOf("</section>", html.indexOf('<section class="launch claim"')));
    expect(claim).toContain("<h1");
    for (const part of ["Web Tools", "Tasks", "Agents"]) {
      expect(claim, part).toContain(part);
    }
  });

  it("links to the questions from the header", () => {
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain('<a href="/#faq">FAQ</a>');
    for (const href of ["/#web-tools", "/#web-tasks", "/#agents"]) {
      expect(header, href).toContain(`href="${href}"`);
    }
  });

  it("offers Log In and Sign Up as two different boxes when signed out", () => {
    expect(html).toContain('<a class="log-in" href="/login">Log In</a>');
    expect(html).toContain('<a class="sign-up" href="/signup">Sign Up</a>');
  });

  it("shows Profile with the account's email instead of Log In and Sign Up when signed in", () => {
    const signedIn = landing(ctx(), { email: "reader@example.com" });
    const header = signedIn.slice(signedIn.indexOf("<header"), signedIn.indexOf("</header>"));
    expect(header).toContain('<a class="profile" href="/dashboard">Profile<span>reader@example.com</span></a>');
    expect(header).not.toContain('href="/login"');
    expect(header).not.toContain('href="/signup"');
  });

  it("has no content links left in the header", () => {
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    for (const href of ["#tools", "#task-api", "#pricing", "/docs", "/agents"]) {
      expect(header, href).not.toContain(`href="${href}"`);
    }
  });

  it("lists every Web Tool, Web Task and Agent by its name after the claim", () => {
    const claimEnd = html.indexOf("</section>", html.indexOf('<section class="launch claim"')) ;
    const reference = html.slice(claimEnd, html.indexOf('id="faq"'));
    for (const tool of ["web_scrape", "web_map", "web_search_exa", "web_session_open", "web_act", "web_session_close", "web_feedback",
      "web_scrape_batch", "web_batch_status", "web_crawl", "web_crawl_status", "web_task_start", "web_task_status", "web_task_cancel"]) {
      expect(reference, tool).toContain(`<code>${tool}</code>`);
    }
    for (const agent of ["price-watch", "web-watch", "competitor-monitor"]) {
      expect(reference, agent).toContain(`/agents/v1/${agent}`);
    }
  });

  it("prices each operation from the API's own numbers, before the questions", () => {
    const pricing = html.slice(html.indexOf('id="pricing"'), html.indexOf('id="faq"'));
    expect(pricing).toContain("1 credit = $0.002");
    expect(pricing).toContain(inDollars(PRICES.sessionOpen));
    expect(pricing).toContain(inDollars(PRICES.action));
    expect(pricing).toContain("Scheduled agents");
  });

  it("ends with the frequently asked questions, each one a closed item", () => {
    const faq = html.indexOf('<section class="content-section" id="faq"');
    expect(faq).toBeGreaterThan(-1);
    expect(html.lastIndexOf("<section")).toBe(faq);
    expect(html.slice(faq).match(/<details id="faq-\d+">/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("keeps every structured FAQ answer identical to the visible answer", () => {
    const schemaText = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    expect(schemaText).toBeTruthy();
    const schema = JSON.parse(schemaText!);
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.mainEntity).toHaveLength(24);
    const escape = (text: string) => text.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`);
    for (const [i, entry] of schema.mainEntity.entries()) {
      expect(html).toContain(`<details id="faq-${i + 1}"><summary>${escape(entry.name)}</summary><p>${escape(entry.acceptedAnswer.text)}</p></details>`);
      expect(entry['@id']).toBe(`https://oassis.dev/#faq-${i + 1}`);
    }
  });

  it("covers all public product routes and MCP tool names inside crawlable FAQs", () => {
    const faq = html.slice(html.indexOf('<section class="content-section" id="faq"'), html.indexOf('<footer'));
    for (const operation of WEB_CATALOG) {
      expect(faq, operation.path).toContain(`${operation.method} ${operation.path}`);
      expect(faq, operation.mcp).toContain(operation.mcp);
    }
    for (const route of ['/agents/v1', '/agents/v1/price-watch', '/agents/v1/web-watch', '/agents/v1/competitor-monitor', '/agents/v1/services', '/agents/v1/services/{id}', '/agents/v1/services/{id}/cancel', '/web/v1/account', '/openapi.json', '/llms.txt', '/.well-known/mcp/server.json']) {
      expect(faq, route).toContain(route);
    }
    expect(faq).toContain('Task-Token');
    expect(faq).toContain('cancel: true');
  });

  it("ends with a footer that links the terms, the privacy policy and its cookie section", () => {
    const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
    expect(footer).toContain('href="/terms"');
    expect(footer).toContain('href="/privacy"');
    expect(footer).toContain('href="/privacy#cookies"');
    expect(footer).toMatch(/<p>© \d{4} Oassis<\/p><nav/);
    expect(html.indexOf("<footer")).toBeGreaterThan(html.indexOf('id="faq"'));
  });

  it("is written in English, like everything a client reads", () => {
    expect(html).not.toMatch(/[áéíóúñ¿¡]|\b(gratis|precio|llamada|navegador)\b/i);
  });
});

describe("what crawlers ask for first", () => {
  it("lets them in and points at the sitemap", () => {
    const txt = robotsTxt(ctx());
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("Sitemap: https://oassis.dev/sitemap.xml");
  });

  it("lists the pages worth indexing", () => {
    const xml = sitemapXml(ctx());
    expect(xml).toContain("<loc>https://oassis.dev/</loc>");
    expect(xml).toContain("/docs</loc>");
    expect(xml).toContain("/browser-api</loc>");
    expect(xml).not.toContain("/web/v1/scrape");
  });
});
