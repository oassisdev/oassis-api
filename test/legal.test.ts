import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { SUPPORT_EMAIL, privacyPage, supportPage, termsPage } from "../src/legal";
import { sitemapXml } from "../src/landing";
import type { Env } from "../src/types";

const ctx = (host = "oassis.dev") =>
  ({ req: { url: `https://${host}/`, path: "/" }, env: { BASE_URL: "https://api.oassis.dev" } }) as unknown as
    Context<{ Bindings: Env }>;

describe("the pages a directory demands", () => {
  const privacy = privacyPage(ctx());
  const support = supportPage(ctx());

  /** A directory rejects a submission outright over a missing or vague policy. */
  it("covers what a privacy policy has to cover", () => {
    for (const topic of ["collect", "store", "Kept", "delete", "Contact", "Children"]) {
      expect(privacy, topic).toContain(topic);
    }
  });

  it("gives one address that a person actually reads, on both pages", () => {
    expect(privacy).toContain(SUPPORT_EMAIL);
    expect(support).toContain(SUPPORT_EMAIL);
  });

  /** A page nothing links to is a page nobody finds. */
  it("is reachable from the sitemap", () => {
    const map = sitemapXml(ctx());
    expect(map).toContain("/privacy");
    expect(map).toContain("/terms");
    expect(map).toContain("/support");
  });

  /**
   * The terms are the one page that says who answers for an access: we fetch what the
   * caller names, and the caller is the one who must have the right to it. A page that
   * ducked that would be the page a directory reviewer reads hardest.
   */
  it("says plainly who answers for what is fetched, and how robots.txt is treated", () => {
    const terms = termsPage(ctx());
    expect(terms).toContain("right to access what you ask for");
    expect(terms).toContain("robots.txt");
    expect(terms, "the paid-call behaviour has to be stated, not implied").toMatch(/Paid calls[\s\S]{0,40}do\b/);
    for (const topic of ["Paying", "do not promise", "Ending it", "Changes", "Contact"]) {
      expect(terms, topic).toContain(topic);
    }
  });

  it("does not promise an uptime it has no way to keep", () => {
    expect(termsPage(ctx())).toContain("do not promise an uptime");
  });

  it("is written in English, like everything a client reads", () => {
    for (const html of [privacy, support]) {
      expect(html).not.toMatch(/[áéíóúñ¿¡]|\b(gratis|precio|privacidad)\b/i);
    }
  });
});
