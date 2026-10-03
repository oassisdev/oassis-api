/**
 * The `bazaar` extension of the x402 challenge: what makes an endpoint discoverable in
 * Coinbase's registry, which is the master the other x402 directories feed from.
 *
 * Our challenge was already a valid x402 v2 one — scheme, network, price, payTo — and we
 * were in none of those directories, because without this extension there is nothing to
 * index. It is one field between us and that whole layer.
 *
 * **The examples are published verbatim**, as the shop window for each resource, and the
 * registry validates each one against the schema beside it and discards the *whole*
 * resource if a single field does not fit. So they are written by hand here rather than
 * generated: there are seven routes, and a hand-written example that works beats a clever
 * one that might not.
 *
 * The schemas are deliberately permissive for the same reason. Their job is to let the
 * example through, not to re-describe an API that `/openapi.json` already describes in
 * full. What an agent copies is the example.
 */

export interface Bazaar {
  info: {
    input: { type: "http"; method: "POST"; bodyType: "json"; body: Record<string, unknown> };
    output: { type: "json"; example: Record<string, unknown> };
  };
  schema: Record<string, unknown>;
}

const SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["http"] },
        method: { type: "string", enum: ["POST"] },
        bodyType: { type: "string", enum: ["json"] },
        body: { type: "object" },
      },
      required: ["type", "method", "bodyType", "body"],
    },
    output: {
      type: "object",
      additionalProperties: false,
      properties: { type: { type: "string", enum: ["json"] }, example: { type: "object" } },
      required: ["type", "example"],
    },
  },
  required: ["input", "output"],
} as const;

const make = (body: Record<string, unknown>, example: Record<string, unknown>): Bazaar => ({
  info: {
    input: { type: "http", method: "POST", bodyType: "json", body },
    output: { type: "json", example },
  },
  schema: SCHEMA as unknown as Record<string, unknown>,
});

/**
 * One example per route: a call that works, and the shape of what comes back.
 *
 * The url is ours on purpose. An example pointing at somebody else's site is a call we
 * publish and cannot keep working, and `example.com` already taught us that lesson by
 * changing its markup under us.
 */
export const BAZAAR = {
  scrape: make(
    { url: "https://oassis.dev", formats: ["markdown", "controls"] },
    { success: true, data: { markdown: "# oassis — web scraping…" }, metadata: { renders: 1 } },
  ),
  session: make(
    { url: "https://oassis.dev", formats: ["controls"] },
    { sessionId: "6f1c…", success: true, data: { controls: [{ ref: "e3", role: "link", name: "OpenAPI" }] } },
  ),
  act: make(
    { sessionId: "6f1c…", actions: [{ scroll: { to: "bottom" } }] },
    { sessionId: "6f1c…", success: true, data: { controls: [] } },
  ),
  batch: make(
    { urls: ["https://oassis.dev", "https://oassis.dev/privacy"], formats: ["markdown"] },
    { jobId: "a52e…", status: "queued", urls: 2 },
  ),
  map: make(
    { url: "https://oassis.dev", includePage: false },
    { urls: ["https://oassis.dev/", "https://oassis.dev/privacy"], discovered: 6 },
  ),
  crawl: make(
    { url: "https://oassis.dev", limit: 5, maxDepth: 1 },
    { jobId: "e6af…", status: "queued", limit: 5 },
  ),
  search: make(
    { query: "model context protocol specification", limit: 5 },
    { engine: "exa", results: [{ title: "Specification", url: "https://modelcontextprotocol.io/specification" }] },
  ),
} as const;
