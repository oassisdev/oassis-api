import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { actDoc, batchDoc, crawlDoc, doc, mapDoc, searchDoc, sessionDoc } from "../src/docs";
import { fieldType, llmsTxt, openapi } from "../src/openapi";
import type { Env } from "../src/types";

/** The docs and the catalogue only need the url the call came in through, and the vars. */
function ctx(path = "/web/v1/scrape", env: Partial<Env> = {}): Context<{ Bindings: Env }> {
  return {
    req: { url: `https://api.oassis.dev${path}`, path },
    env: {
      X402_PAY_TO: "0x23Fc725e8EAa1c58900C6507Ba89be99a6DFc75d",
      X402_NETWORK: "base",
      BASE_URL: "https://api.oassis.dev",
      ...env,
    },
  } as unknown as Context<{ Bindings: Env }>;
}

const DOCS = { doc, sessionDoc, actDoc, batchDoc, mapDoc, crawlDoc, searchDoc };

describe("every documented field can be typed", () => {
  /**
   * The whole catalogue is generated from the prose the endpoints already answer with, so
   * this is the guard that keeps that honest: a field written in some new shape would
   * silently vanish from the OpenAPI instead of failing.
   */
  it("leaves nothing out of the schema", () => {
    const untypeable: string[] = [];
    for (const [name, build] of Object.entries(DOCS)) {
      const described = build(ctx()) as { request?: Record<string, string> };
      for (const [field, prose] of Object.entries(described.request ?? {})) {
        if (!fieldType(prose)) untypeable.push(`${name}.${field}: ${prose.slice(0, 40)}`);
      }
    }
    expect(untypeable).toEqual([]);
  });

  it("reads the type from the house style", () => {
    expect(fieldType("string — page to process")).toEqual({ type: "string", description: "page to process" });
    expect(fieldType("number — how many")).toEqual({ type: "number", description: "how many" });
    expect(fieldType("array of string — required")).toEqual({ type: "array", description: "required" });
    expect(fieldType("{ fullPage, type }")?.type).toBe("object");
    expect(fieldType("boolean — whether to wait")?.type).toBe("boolean");
  });
});

describe("the catalogue", () => {
  it("describes every paid route, on the host it was asked from", () => {
    const spec = openapi(ctx()) as { paths: Record<string, unknown>; servers: { url: string }[] };
    expect(Object.keys(spec.paths).sort()).toEqual([
      "/web/v1/act",
      "/web/v1/crawl",
      "/web/v1/map",
      "/web/v1/scrape",
      "/web/v1/scrape/batch",
      "/web/v1/search/exa",
      "/web/v1/session",
    ]);
    expect(spec.servers[0]?.url).toBe("https://api.oassis.dev");

  });

  /**
   * The catalogue is served at /openapi.json, which carries no family prefix, so the paths
   * it advertises have to come from the host. Reading them off the request path published
   * the family's names on the umbrella.
   */
  it("advertises the paths of the host it was asked from, not of its own url", () => {
    const umbrella = openapi(ctx("/openapi.json")) as { paths: Record<string, unknown> };
    expect(Object.keys(umbrella.paths)).toContain("/web/v1/scrape");

    const family = {
      req: { url: "https://web.oassis.dev/openapi.json", path: "/openapi.json" },
      env: { BASE_URL: "https://api.oassis.dev" },
    } as unknown as Parameters<typeof openapi>[0];
    const spec = openapi(family) as { paths: Record<string, unknown>; servers: { url: string }[] };
    expect(Object.keys(spec.paths)).toContain("/v1/scrape");
    expect(spec.servers[0]?.url).toBe("https://web.oassis.dev");
  });

  it("quotes a real price, not a promise to compute one", () => {
    const spec = openapi(ctx()) as {
      paths: Record<string, { post: { "x-x402": { price: string; payTo: string; network: string } } }>;
    };
    for (const [path, entry] of Object.entries(spec.paths)) {
      expect(entry.post["x-x402"].price, path).toMatch(/\$\d/);
      expect(entry.post["x-x402"].payTo, path).toBe("0x23Fc725e8EAa1c58900C6507Ba89be99a6DFc75d");
      expect(entry.post["x-x402"].network, path).toBe("eip155:8453");
    }
  });

  it("says nothing about a wallet when this deployment has none", () => {
    const spec = openapi(ctx("/web/v1/scrape", { X402_PAY_TO: undefined })) as {
      "x-payment": Record<string, unknown>;
    };
    expect(spec["x-payment"]).not.toHaveProperty("payTo");
  });

  it("names the test network when that is what it charges on", () => {
    const spec = openapi(ctx("/web/v1/scrape", { X402_NETWORK: "base-sepolia" })) as {
      "x-payment": { network: string };
    };
    expect(spec["x-payment"].network).toBe("eip155:84532");
  });

  it("carries a request example an agent can copy", () => {
    const spec = openapi(ctx()) as {
      paths: Record<string, { post: { requestBody: { content: Record<string, { example?: unknown }> } } }>;
    };
    expect(spec.paths["/web/v1/scrape"]?.post.requestBody.content["application/json"]?.example).toMatchObject({
      url: expect.any(String),
    });
  });
});

describe("llms.txt", () => {
  const text = llmsTxt(ctx());

  /**
   * Seven routes are charged for and six were published: `act` had no document of its own,
   * so it was invisible to every directory and its GET answered 404.
   */
  it("publishes every route the guard charges for", () => {
    const spec = openapi(ctx()) as { paths: Record<string, unknown> };
    for (const path of ["scrape", "session", "act", "scrape/batch", "map", "crawl", "search/exa"]) {
      expect(Object.keys(spec.paths), path).toContain(`/web/v1/${path}`);
    }
  });

  it("lists every endpoint with its price and its tool", () => {
    for (const path of ["/web/v1/scrape", "/web/v1/map", "/web/v1/crawl", "/web/v1/search/exa"]) {
      expect(text).toContain(`### POST ${path}`);
    }
    expect(text).toContain("web_search_exa");
    expect(text).toMatch(/- Price: from \$\d/);
  });

  it("explains both ways to pay, and points at the machine-readable one", () => {
    expect(text).toContain("402");
    expect(text).toContain("Authorization: Bearer oas_");
    expect(text).toContain("https://api.oassis.dev/openapi.json");
    expect(text).toContain("https://api.oassis.dev/mcp");
  });

  it("is written in English, like everything a client reads", () => {
    expect(text).not.toMatch(/[áéíóúñ¿¡]|\b(precio|llamada|gratis|cuenta)\b/i);
  });
});
