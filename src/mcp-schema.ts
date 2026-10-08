/**
 * The MCP catalogue, generated from the validator.
 *
 * `tools/list` is the API as far as an agent is concerned: it can only ask for what the
 * catalogue shows it. That catalogue used to be written by hand, next to —but not from—
 * the schemas that validate every call, and the two drifted: `web_scrape` declared seven
 * properties of the sixteen it accepted, `web_crawl` eight of seventeen. Nine options on
 * each were built, paid for and working, and invisible to every client.
 *
 * So the shape is derived from the Zod schema and cannot fall behind it, while the prose
 * stays hand-written: what a parameter *is* can be generated, what it is *for* cannot,
 * and an agent chooses a tool by reading. `PROSE` is overlaid on the generated shape, and
 * `test/mcp-declara-todo.test.ts` fails if a tool ever accepts something it does not show.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";

/** A JSON Schema object, as far as this file needs to care. */
interface Ficha {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * What each parameter is for, in the words an agent reads before choosing.
 *
 * Keyed by property name, so a parameter shared by several tools is explained once and
 * the same way everywhere. A key with no entry still appears in the catalogue —the shape
 * is generated— it just goes undescribed, which is the mild failure, not the silent one.
 */
export const PROSE: Record<string, string> = {
  url: "Page to process.",
  html: "Raw HTML instead of `url`, for a page you already have. Nothing leaves for the network.",
  urls: "The pages of this batch. Two to fifty, no duplicates: a batch charges per url.",
  maxAge:
    "Accept an answer up to this many milliseconds old. A cache hit costs $0.0002 instead of the format price. Leave it out to force a fresh render.",
  formats:
    "Outputs you want in the same response. `controls` is the map of what can be clicked; `elements` needs `selectors`; `json` needs `json.prompt` or `json.schema`.",
  selectors: "CSS selectors for the `elements` format.",
  json: "For the `json` format: a `prompt` describing what to pull out, a JSON `schema` to fill, or both.",
  wait:
    "When to consider the page loaded: `until` (load, domcontentloaded, networkidle0, networkidle2), `selector` to wait for, `timeout` in ms.",
  screenshot:
    "Options for the `screenshot` format: `fullPage` for the whole page, `type` (png, jpeg, webp), `quality` 1-100 (not with png), `omitBackground`, `selector` to capture one element, and its own `viewport`.",
  pdf: "Options for the `pdf` format: `format` (a4, letter, legal…), `landscape`, `printBackground`, `scale` 0.1 to 2.",
  links: "Options for the `links` format: `visibleOnly`, `excludeExternal` to keep only internal links.",
  controls: "Options for the `controls` format: `visibleOnly`, and `limit` (1 to 1000) to cut the map.",
  request:
    "How to make the request: `headers`, `cookies`, `userAgent`, and `auth` for basic authentication.",
  block:
    "What not to load, which makes a render faster and cheaper. `resourceTypes` takes image, font, stylesheet, media… and `urlPatterns` are regular expressions, not globs: `\\.svg$`, not `*.svg`.",
  binaryAs: "How a screenshot or a PDF comes back. `base64` is the only value today.",
  viewport: "The window to render in: `width`, `height`, `deviceScaleFactor`.",
  sessionId: "The session to act on, from `web_session_open`.",
  actions:
    "What to do, in order: click, type, select, scroll, hover, press, navigate, wait. One to twenty-five per call.",
  limit: "How many pages this may read. Charged up front; whatever it does not read comes back.",
  maxDepth: "How far from the starting page to follow links.",
  includePage:
    "Render the page too, to catch urls the sitemap does not list. `false` uses no browser at all and costs a fifth.",
  search: "Keep only urls containing this text.",
  includeSubdomains: "Treat subdomains of the same site as part of it.",
  includePaths: "Keep only urls whose path contains one of these. Up to twenty.",
  excludePaths: "Discard urls whose path contains one of these. Up to twenty. It wins over `includePaths`.",
};

/**
 * The catalogue entry for a schema: its shape, derived, with the prose laid over it.
 *
 * `extra` adds a property the schema does not carry, and `narrow` replaces a generated
 * one. Narrowing is the only place the catalogue may differ from the validator, and only
 * ever to promise *less*: a crawl refuses `screenshot` in `formats`, so showing it in the
 * published enum would be an invitation to a rejection.
 */
export function fichaDe(
  schema: ZodTypeAny,
  options: {
    extra?: Record<string, Record<string, unknown>>;
    narrow?: Record<string, Record<string, unknown>>;
    omit?: string[];
    /** Forced, for a requirement the schema states in a `superRefine` and not in a type. */
    required?: string[];
  } = {},
): Ficha {
  const generada = zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema7" }) as Ficha;
  const properties: Record<string, Record<string, unknown>> = {};

  for (const [clave, valor] of Object.entries({ ...generada.properties, ...options.extra })) {
    if (options.omit?.includes(clave)) continue;
    const campo = options.narrow?.[clave] ?? valor;
    // The generated description wins when the schema carries one: it sits next to the
    // rule it describes and cannot drift from it.
    properties[clave] = campo.description ? campo : { ...campo, ...(PROSE[clave] ? { description: PROSE[clave] } : {}) };
  }

  const required = (options.required ?? generada.required ?? []).filter((k) => k in properties);
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}
