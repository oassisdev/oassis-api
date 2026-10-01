import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import { mapSite } from "../src/map";
import { servedText } from "../src/landing";
import type { Env } from "../src/types";

const ctx = (host = "api.oassis.dev") =>
  ({ req: { url: `https://${host}/`, path: "/" }, env: { BASE_URL: "https://api.oassis.dev" } }) as unknown as
    Context<{ Bindings: Env }>;

/**
 * A Worker cannot fetch its own hostname: the request loops back and never resolves.
 * web_map answered with zero urls for oassis.dev while mapping every other site, which
 * made the one site in all our examples the one our own tool could not read.
 */
describe("mapping our own site", () => {
  /**
   * The request arrives on api.oassis.dev and asks about oassis.dev — which is how it
   * happens, because the MCP endpoint lives on the api host. The first fix answered with
   * the *asking* host's sitemap, so every url in it was discarded as off-site and the
   * count stayed at zero. A test that used one host for both passed anyway.
   */
  it("answers for the host that was asked about, without touching the network", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    const res = await mapSite(
      { url: "https://oassis.dev", limit: 20, includePage: false } as never,
      async () => [],
      servedText(ctx("api.oassis.dev")),
    );
    for (const u of res.urls) expect(u, "a url from the wrong host").toContain("//oassis.dev/");
    expect(network, "a request left the Worker for its own host").not.toHaveBeenCalled();
    expect(res.urls.length, "our own site mapped to nothing").toBeGreaterThan(0);
    expect(res.urls).toContain("https://oassis.dev/privacy");
    expect(res.sitemaps).toContain("https://oassis.dev/sitemap.xml");
    network.mockRestore();
  });

  it("leaves anyone else's site to the network", () => {
    const served = servedText(ctx());
    expect(served("https://example.org/robots.txt")).toBeNull();
    expect(served("not a url")).toBeNull();
  });

  it("covers every host this Worker answers on", () => {
    const served = servedText(ctx());
    for (const host of ["oassis.dev", "www.oassis.dev", "api.oassis.dev", "web.oassis.dev"]) {
      expect(served(`https://${host}/robots.txt`), host).toContain("Sitemap:");
    }
  });
});
