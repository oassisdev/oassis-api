/**
 * Resources and prompts, so a client can read the catalogue and start without a manual.
 *
 * Both methods answered `-32601` and the directories noticed: an inspection that finds
 * three capabilities where a server declares one files it as incomplete. They are also
 * worth having on their own terms — the two documents below are the ones an agent reads
 * before its first call, and the prompts are the three things people actually do.
 *
 * Nothing here costs anything: a resource is a document we already serve, and a prompt is
 * text. Neither touches a browser.
 */

import type { Context } from "hono";
import { llmsTxt, openapi } from "./openapi";
import type { Env } from "./types";

type Ctx = Context<{ Bindings: Env }>;

export const RESOURCES = [
  {
    uri: "oassis://openapi.json",
    name: "openapi",
    title: "Every route, its fields and its price",
    description:
      "The OpenAPI document for the whole API: each route, the fields it accepts, what it answers, and what the call costs. Read this before constructing a request by hand.",
    mimeType: "application/json",
  },
  {
    uri: "oassis://llms.txt",
    name: "llms",
    title: "The same catalogue, as plain text",
    description:
      "The catalogue written for a model to read in one pass, without parsing a schema. Shorter than the OpenAPI document and enough to decide which route to call.",
    mimeType: "text/plain",
  },
] as const;

/**
 * The document behind each uri.
 *
 * Generated here rather than fetched from our own url: a Worker cannot fetch its own
 * hostname — the request loops back and never resolves — which is the same trap that
 * left web_map unable to map oassis.dev.
 */
export function readResource(c: Ctx, uri: string): { text: string; mimeType: string } | null {
  if (uri === "oassis://openapi.json") {
    return { text: JSON.stringify(openapi(c), null, 2), mimeType: "application/json" };
  }
  if (uri === "oassis://llms.txt") return { text: llmsTxt(c), mimeType: "text/plain" };
  return null;
}

export function PROMPTS(_c: Ctx) {
  return [
    {
      name: "read-a-page",
      title: "Read a page properly",
      description: "Turn a url into markdown, and get the map of what can be clicked at the same time.",
      arguments: [{ name: "url", description: "The page to read.", required: true }],
      text: (a: Record<string, string>) =>
        `Read ${a.url ?? "<url>"} with web_scrape, asking for formats ["markdown","controls"]. ` +
        `Summarise what the page is for, then list what can be acted on, using the readable names from controls — not the selectors. ` +
        `If the page turns out to be a PDF or a spreadsheet it comes back as markdown anyway, with no browser involved.`,
    },
    {
      name: "research-a-site",
      title: "Research a whole site without wasting calls",
      description: "List a site's urls first, decide what is worth reading, and only then read it.",
      arguments: [
        { name: "url", description: "The site to research.", required: true },
        { name: "about", description: "What you are looking for.", required: false },
      ],
      text: (a: Record<string, string>) =>
        `Call web_map on ${a.url ?? "<url>"} with includePage false. It is the cheapest call in the API and it needs no browser. ` +
        `From the urls it returns, choose the ones that look relevant${a.about ? ` to: ${a.about}` : ""} and read those with web_scrape_batch. ` +
        `Do not crawl first: mapping tells you what is there for a fraction of the price, and a crawl you did not need is the easiest way to spend money for nothing.`,
    },
    {
      name: "fill-in-a-form",
      title: "Fill in or click something on a live page",
      description: "Open a browser session, act on it with the refs the control map gave you, and close it.",
      arguments: [
        { name: "url", description: "The page with the form.", required: true },
        { name: "task", description: "What to do on it.", required: false },
      ],
      text: (a: Record<string, string>) =>
        `Open a session on ${a.url ?? "<url>"} with web_session_open, asking for formats ["controls"]. ` +
        `Use the refs it returns with web_act to ${a.task ?? "fill in the form and submit it"}. ` +
        `The refs keep working between calls inside the same session, so look again after each step rather than guessing. ` +
        `Close it with web_session_close when you are done: an open browser is billed by the minute.`,
    },
  ];
}

/** What a keyless client gets, said once here so the prompts and the docs cannot disagree. */
export const freeLine = () =>
  "Without a key, every tool works over MCP except web_search_exa, which is paid.";
