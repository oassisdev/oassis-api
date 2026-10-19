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

/** Web Tools use /web/v1 on every API host. */
export function prefixForHost(_c: Context<{ Bindings: Env }>): string { return "/web/v1"; }

/** Operation families use the same prefix on every host. */
export function prefix(c: Context<{ Bindings: Env }>): string {
 return c.req.path.startsWith('/tasks/v1/')?'/tasks/v1':'/web/v1';
}

/**
 * A document that describes a route never changes between deploys, so it is marked
 * cacheable: with a cache rule on the zone, repeats are served by the edge and never
 * reach the Worker at all. These endpoints are free to call, which means every repeat is
 * ours to pay for.
 */
export function cacheableDoc(c: Context<{ Bindings: Env }>, body: unknown): Response {
  return c.json(body as never, 200, {
    "cache-control": "public, max-age=0, must-revalidate",
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
