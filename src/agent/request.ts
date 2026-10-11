/**
 * The request a client sends to start a task. Unknown fields and unsupported modes are
 * refused, not ignored: a silently dropped limit is a budget nobody agreed to.
 */

import { z } from "zod";

export const TASK_MODES = ["research"] as const;

export const DEFAULT_LIMITS = { max_cost_usd: 0.1, max_duration_seconds: 180, max_steps: 10 } as const;
export const MAX_LIMITS = { max_cost_usd: 1, max_duration_seconds: 900, max_steps: 20 } as const;
export const MIN_COST_USD = 0.01;
export const MAX_URLS = 5;

export const taskRequest = z
  .object({
    task: z.string().trim().min(10).max(2_000).describe("What to find out, in plain words. Be specific about what to compare."),
    mode: z.enum(TASK_MODES).default("research").describe("Only research is available: read public pages and answer."),
    urls: z.array(z.string().url().max(500)).max(MAX_URLS).default([]).describe("Pages to read first, up to 5. Public http or https urls only."),
    limits: z
      .object({
        max_cost_usd: z.number().min(MIN_COST_USD).max(MAX_LIMITS.max_cost_usd).default(DEFAULT_LIMITS.max_cost_usd).describe("Most the task may cost, in USD. Reserved up front; the rest is returned."),
        max_duration_seconds: z
          .number()
          .int()
          .min(30)
          .max(MAX_LIMITS.max_duration_seconds)
          .default(DEFAULT_LIMITS.max_duration_seconds)
          .describe("Longest the task may run, in seconds."),
        max_steps: z.number().int().min(1).max(MAX_LIMITS.max_steps).default(DEFAULT_LIMITS.max_steps).describe("Most decisions the planner may take."),
      })
      .strict()
      .default({})
      .describe("Bounds on cost, time and steps."),
  })
  .strict();

/**
 * Refuses hosts that point inside our network or at a literal address we should not visit.
 * This is a first filter on the URL, not a protection against SSRF: DNS can resolve a public
 * name to a private address, and redirects can lead anywhere. The reader must also refuse
 * those; see the documentation for what is and is not covered.
 */
export function checkPublicUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "invalid_url";
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "unsupported_scheme";
  if (u.username || u.password) return "credentials_in_url";
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") && !host.includes(":")) return "private_host";
  if (/\.(local|internal|localhost|lan|home|corp)$/.test(host) || host === "localhost") return "private_host";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number) as [number, number];
    const private_ =
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
    if (private_) return "private_address";
  }
  if (host.includes(":")) {
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host === "::") {
      return "private_address";
    }
  }
  return null;
}
