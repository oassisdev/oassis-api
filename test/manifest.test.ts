import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../server.json";

describe("the MCP manifest at /.well-known/mcp/server.json", () => {
  it("names the server the way the official registry does", () => {
    expect(manifest.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(manifest.name).toBe("dev.oassis/scraper-crawler");
  });

  it("points at the streamable endpoint clients connect to", () => {
    expect(manifest.remotes[0]?.type).toBe("streamable-http");
    expect(manifest.remotes[0]?.url).toBe("https://api.oassis.dev/mcp");
  });

  it("is served from the worker, on every host", () => {
    expect(readFileSync("src/index.ts", "utf8")).toContain('app.get("/.well-known/mcp/server.json"');
  });
});
