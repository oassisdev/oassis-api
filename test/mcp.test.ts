import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version";
import { mcp } from "../src/mcp";

/** Minimal env: a database that recognises no key. */
const env = {
  BILLING: {
    prepare() {
      return { bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) };
    },
  },
} as unknown as Parameters<typeof mcp.request>[2];

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  mcp.request(
    "/mcp",
    { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } },
    env,
  );

describe("MCP protocol", () => {
  it("initialize states the version, the capabilities and how to pay", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const { result } = (await r.json()) as any;
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities.tools).toEqual({});
    // The identity the official registry lists, so a client and the directory that
    // sent it there do not disagree about what this server is called.
    expect(result.serverInfo.name).toBe("oassis");
    expect(result.serverInfo.version).toBe(VERSION);
    expect(result.instructions).toMatch(/Authorization/);
  });

  it("tools/list brings every tool with its schema", async () => {
    const r = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const { result } = (await r.json()) as any;
    expect(result.tools.map((t: any) => t.name)).toEqual([
      "web_scrape",
      "web_session_open",
      "web_act",
      "web_scrape_batch",
      "web_batch_status",
      "web_map",
      "web_crawl",
      "web_crawl_status",
      "web_search_exa",
      "web_feedback",
      "web_session_close",
    ]);
    for (const t of result.tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it("a notification carries no response", async () => {
    const r = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r.status).toBe(202);
    expect(await r.text()).toBe("");
  });

  it("ping answers empty", async () => {
    const { result } = (await (await rpc({ jsonrpc: "2.0", id: 3, method: "ping" })).json()) as any;
    expect(result).toEqual({});
  });

  it("an unknown method is a JSON-RPC error, not a 500", async () => {
    const { error } = (await (await rpc({ jsonrpc: "2.0", id: 4, method: "resources/list" })).json()) as any;
    expect(error.code).toBe(-32601);
  });

  it("a non-JSON body is rejected with -32700", async () => {
    const r = await mcp.request(
      "/mcp",
      { method: "POST", body: "not json", headers: { "content-type": "application/json" } },
      env,
    );
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error.code).toBe(-32700);
  });

  it("a GET explains the transport instead of failing", async () => {
    const r = await mcp.request("/mcp", { method: "GET" }, env);
    const body = (await r.json()) as any;
    expect(body.auth).toMatch(/Bearer/);
    expect(body.tools).toContain("web_scrape");
  });
});

describe("billing over MCP", () => {
  it("with no key, it states the price and how to send one", async () => {
    const { result } = (await (
      await rpc({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "web_scrape", arguments: { url: "https://a.com", formats: ["markdown"] } },
      })
    ).json()) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("$0.001");
    expect(result.content[0].text).toMatch(/Authorization: Bearer/);
  });

  it("the announced price depends on what is requested", async () => {
    const { result } = (await (
      await rpc({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "web_scrape", arguments: { url: "https://a.com", formats: ["markdown", "pdf"] } },
      })
    ).json()) as any;
    expect(result.content[0].text).toContain("$0.003");
  });

  it("a key the database does not recognise is rejected", async () => {
    const { result } = (await (
      await rpc(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "web_scrape", arguments: { url: "https://a.com" } },
        },
        { authorization: "Bearer oas_madeup" },
      )
    ).json()) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Invalid or revoked/);
  });

  it("a tool that does not exist is -32602", async () => {
    const { error } = (await (
      await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "web_hack" } })
    ).json()) as any;
    expect(error.code).toBe(-32602);
  });

  it("closing a session needs no key: stopping spending is not billed", async () => {
    const { error } = (await (
      await rpc({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "web_session_close", arguments: {} },
      })
    ).json()) as any;
    // With no sessionId this is a parameter error, not a payment one.
    expect(error.code).toBe(-32602);
  });
});
