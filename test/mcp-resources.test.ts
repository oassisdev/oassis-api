import { describe, expect, it } from "vitest";
import { mcp } from "../src/mcp";
import { RESOURCES } from "../src/mcp-resources";

const env = {
  BASE_URL: "https://api.oassis.dev",
  BILLING: {
    prepare() {
      return { bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) };
    },
  },
} as unknown as Parameters<typeof mcp.request>[2];

const rpc = async (body: unknown) => {
  const r = await mcp.request(
    "/mcp",
    { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } },
    env,
  );
  return (await r.json()) as any;
};

describe("resources and prompts", () => {
  /** Declaring only tools is what had the directories filing this server as incomplete. */
  it("declares all three capabilities", async () => {
    const { result } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(result.capabilities).toHaveProperty("tools");
    expect(result.capabilities).toHaveProperty("resources");
    expect(result.capabilities).toHaveProperty("prompts");
  });

  it("lists resources, and every one of them can actually be read", async () => {
    const { result } = await rpc({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    expect(result.resources.length).toBe(RESOURCES.length);
    for (const r of result.resources) {
      const read = await rpc({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: r.uri } });
      expect(read.error, `${r.uri} is listed but cannot be read`).toBeUndefined();
      expect(read.result.contents[0].text.length, r.uri).toBeGreaterThan(50);
    }
  });

  it("refuses a resource it does not have, rather than inventing one", async () => {
    const { error } = await rpc({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "oassis://nope" } });
    expect(error.code).toBe(-32602);
  });

  it("lists prompts, and every one of them can be fetched", async () => {
    const { result } = await rpc({ jsonrpc: "2.0", id: 5, method: "prompts/list" });
    expect(result.prompts.length).toBeGreaterThan(0);
    for (const p of result.prompts) {
      expect(p.title, p.name).toBeTruthy();
      const got = await rpc({ jsonrpc: "2.0", id: 6, method: "prompts/get", params: { name: p.name } });
      expect(got.error, `${p.name} is listed but cannot be fetched`).toBeUndefined();
      expect(got.result.messages[0].content.text.length).toBeGreaterThan(80);
    }
  });

  /** A prompt that ignores its arguments is a prompt that lies about taking them. */
  it("puts the arguments into the prompt it returns", async () => {
    const got = await rpc({
      jsonrpc: "2.0",
      id: 7,
      method: "prompts/get",
      params: { name: "read-a-page", arguments: { url: "https://example.org/thing" } },
    });
    expect(got.result.messages[0].content.text).toContain("https://example.org/thing");
  });

  it("refuses a prompt it does not have", async () => {
    const { error } = await rpc({ jsonrpc: "2.0", id: 8, method: "prompts/get", params: { name: "nope" } });
    expect(error.code).toBe(-32602);
  });
});
