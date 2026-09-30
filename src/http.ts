/**
 * Shared shapes for HTTP answers, so the billing guard and the handlers cannot
 * describe the same failure in two different ways.
 */

import type { Context } from "hono";
import type { ZodError } from "zod";
import type { Env } from "./types";

export function origin(c: Context<{ Bindings: Env }>): string {
  return new URL(c.req.url).origin;
}

/**
 * The prefix a host serves, when there is no path to read it from — the front page, the
 * catalogue, a probe. A family host (`web.oassis.dev`) serves `/v1/…`; everything else, the
 * umbrella (`api.oassis.dev`) and the bare domain, serves `/web/v1/…`.
 *
 * This was written three times with three different rules. The version that compared the
 * host against BASE_URL would have called `oassis.dev` a family the day it started
 * answering, and published the wrong paths on it.
 */
const FAMILIES = new Set(["web"]);

export function prefixForHost(c: Context<{ Bindings: Env }>): string {
  const label = new URL(c.req.url).hostname.split(".")[0] ?? "";
  return FAMILIES.has(label) ? "/v1" : "/web/v1";
}

/** The prefix the call came in through: `/web/v1` on the umbrella, `/v1` on a family host. */
export function prefix(c: Context<{ Bindings: Env }>): string {
  return c.req.path.startsWith("/web/v1/") ? "/web/v1" : "/v1";
}

/**
 * A document that describes a route never changes between deploys, so it is marked
 * cacheable: with a cache rule on the zone, repeats are served by the edge and never
 * reach the Worker at all. These endpoints are free to call, which means every repeat is
 * ours to pay for.
 */
export function cacheableDoc(c: Context<{ Bindings: Env }>, body: unknown): Response {
  return c.json(body as never, 200, {
    "cache-control": "public, max-age=3600",
  });
}

export function badRequest(c: Context<{ Bindings: Env }>, e: ZodError): Response {
  return c.json(
    {
      success: false,
      error: "bad_request",
      message: "The request is not valid.",
      issues: e.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
      docs: `${origin(c)}${prefix(c)}/scrape`,
    },
    400,
  );
}
