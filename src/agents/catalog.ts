/**
 * The three free agent services. A client configures one with parameters, never a prompt,
 * and the service runs on its schedule, keeping the last read of each target so each
 * report says what changed.
 */
import { z } from "zod";

const frequency = z.enum(["daily", "weekly"]).default("daily").describe("How often the service runs.");
const urls = z
  .array(z.string().url().max(2048))
  .min(1)
  .max(10)
  .describe("Public page URLs to watch. Up to 10 per service.");

export const agentSchemas = {
  "price-watch": z
    .object({
      urls,
      frequency,
      alert_drop_percent: z
        .number()
        .min(0)
        .max(100)
        .default(5)
        .describe("Report a price drop of at least this percentage."),
    })
    .strict(),
  "web-watch": z
    .object({
      urls,
      frequency,
      keywords: z
        .array(z.string().min(1).max(60))
        .max(10)
        .default([])
        .describe("Report a change only when a changed line contains one of these words."),
    })
    .strict(),
  "competitor-monitor": z
    .object({
      domain: z.string().url().max(2048).describe("The competitor's home page, for example https://example.com."),
      sections: z
        .array(z.string().regex(/^\/[^\s]*$/).max(200))
        .min(1)
        .max(10)
        .default(["/pricing", "/blog", "/changelog"])
        .describe("Paths on that domain to watch, starting with /."),
      frequency: z.enum(["daily", "weekly"]).default("weekly").describe("How often the service runs."),
    })
    .strict(),
} as const;

export type AgentName = keyof typeof agentSchemas;
export const AGENT_NAMES = Object.keys(agentSchemas) as AgentName[];

export const AGENT_INFO: Record<AgentName, { title: string; summary: string; intervalMs: Record<"daily" | "weekly", number> }> = {
  "price-watch": {
    title: "Price watch",
    summary: "Reads product pages on your schedule and reports price changes and drops.",
    intervalMs: { daily: 86_400_000, weekly: 7 * 86_400_000 },
  },
  "web-watch": {
    title: "Web change watch",
    summary: "Watches pages for changes and reports what was added or removed, optionally filtered by keyword.",
    intervalMs: { daily: 86_400_000, weekly: 7 * 86_400_000 },
  },
  "competitor-monitor": {
    title: "Competitor monitor",
    summary: "Watches a competitor's pricing, blog and changelog pages and reports what changed.",
    intervalMs: { daily: 86_400_000, weekly: 7 * 86_400_000 },
  },
};

/** Limits that keep a free service from becoming a free crawler. */
export const LIMITS = {
  activePerAccount: 10,
  runsPerTick: 3,
  readsPerRun: 10,
};
