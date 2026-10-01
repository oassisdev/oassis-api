import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ICON_LINKS, mountIcon } from "../src/icon";
import type { Env } from "../src/types";

const app = new Hono<{ Bindings: Env }>();
mountIcon(app);

const get = (path: string) => app.request(path, {}, {} as Env);

describe("the mark", () => {
  it.each([
    ["/favicon.svg", "image/svg+xml"],
    ["/favicon.ico", "image/x-icon"],
    ["/apple-touch-icon.png", "image/png"],
    ["/icon-512.png", "image/png"],
  ])("serves %s", async (path, type) => {
    const r = await get(path);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain(type);
    expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("caches hard, because the bytes only change when the path does", async () => {
    const r = await get("/favicon.svg");
    expect(r.headers.get("cache-control")).toContain("immutable");
  });

  /** A page that links to a file we do not serve shows a broken icon, silently. */
  it("links only to files that exist", async () => {
    const hrefs = [...ICON_LINKS.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect((await get(href)).status).toBe(200);
  });
});
