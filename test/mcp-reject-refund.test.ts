import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mcp } from "../src/mcp";

/**
 * Over HTTP the billing guard validates before charging: "nothing invalid ever reaches a
 * charge". Over MCP the charge comes first, because the price depends on the arguments —
 * and the eight rejections kept the money. Asking for a batch of one url, which the
 * schema refuses, cost $0.001 for a request that never ran.
 *
 * Found by sending a deliberately invalid batch and then reading the ledger.
 */
describe("arguments that do not parse", () => {
  it("still answers with the reason, not a bare failure", async () => {
    const env = {
      BILLING: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) }) },
    } as unknown as Parameters<typeof mcp.request>[2];
    const r = await mcp.request(
      "/mcp",
      {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "tools/call",
          params: { name: "web_scrape_batch", arguments: { urls: ["https://oassis.dev"] } },
        }),
        headers: { "content-type": "application/json" },
      },
      env,
    );
    const { result } = (await r.json()) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("2 element");
  });

  it("gives the charge back, on every tool that validates", () => {
    const src = readFileSync("src/mcp.ts", "utf8");
    expect(src).toContain("refund: the request was not valid");
    // Every rejection goes through the helper; none answers without giving the money back.
    const sueltas = src.match(/return finish\(issuesText\([a-z]+\.error\.issues\), true\)/g) ?? [];
    expect(sueltas, "a rejection that keeps the money").toHaveLength(0);
    expect((src.match(/return rechazar\(/g) ?? []).length).toBeGreaterThanOrEqual(8);
  });

  it("keeps the HTTP door's rule, which was the one doing it right", () => {
    expect(readFileSync("src/billing/index.ts", "utf8")).toContain("nothing invalid ever reaches a charge");
  });
});
