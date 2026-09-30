/**
 * The keyless tier: a demo, not a plan.
 *
 * It exists to cover the thirty seconds between "what is this" and "my agent pays for
 * itself" — and that is a much smaller job than the free plans of services whose only
 * payment rail is a card. Somebody with a wallet can pay us $0.001 with no account at all,
 * so the free tier does not have to carry a trial: it has to make the first call work.
 *
 * Which is why it is small, and shaped by the first thirty seconds rather than by cost:
 *
 * - **Reading a page or a document, and listing a site's urls**: one call in, an answer
 *   out, nothing to poll. Ten a day of each is plenty to see whether this is any good.
 * - **One browser session, once ever.** The control map is the thing nobody else has, so
 *   the demo has to show it — and once is enough to see it, while being impossible to farm.
 * - **Crawls, batches and AI extraction need a key.** Not because of the money: because a
 *   stranger who starts a crawl gets a job id and a polling loop, which demonstrates
 *   nothing. A bad first impression is worse than no impression.
 *
 * Small on purpose, and shaped by that first call rather than by generosity: an allowance
 * with no shape attracts crawlers rather than callers.
 */

import type { Env, Format } from "./types";

/** Calls a day, per caller, on the two operations that answer in one step. */
export const FREE_PER_DAY = { scrape: 10, map: 10 } as const;

/** Given once per caller, ever: the demo only has to be seen once. */
export const FREE_EVER = { sessions: 1, actions: 10, searches: 5 } as const;

/** Pages of the same site a day: three is trying it, three hundred is harvesting it. */
export const FREE_PER_HOST = 3;

/** A ceiling for the whole free tier, in money, across everybody, per day. */
export const FREE_SPEND_GLOBAL_DAY = 5_000_000; // $5

/**
 * A second, much smaller ceiling for the free calls that cost cash.
 *
 * A search is the one free call that is bought from somebody else, with the same wallet that
 * serves paying callers — so it gets a budget of its own rather than sharing the ceiling
 * above. Enough that a first search works, bounded so that a swarm cannot turn it into an
 * outage for the people paying for it.
 */
export const FREE_CASH_DAY = 200_000; // $0.20

/** The free tools that are bought from somebody else rather than served from here. */
export const FREE_CASH_TOOLS: ReadonlySet<string> = new Set(["web_search_exa"]);

/** Tools a keyless caller may use at all. The rest say so and explain how to pay. */
export const FREE_TOOLS: ReadonlySet<string> = new Set([
  "web_scrape",
  "web_map",
  "web_session_open",
  "web_act",
  "web_search_exa",
]);

/** Outputs a free call may ask for: no model call, no heavy render. */
export const FREE_FORMATS: ReadonlySet<Format> = new Set([
  "markdown",
  "html",
  "links",
  "controls",
  "accessibility",
  "elements",
]);

/** Free answers accept an hour-old cache: a swarm on the same pages costs one render. */
export const FREE_MAX_AGE_MS = 60 * 60 * 1000;

/** Defaults of HTTP libraries and crawlers: the free tier is for MCP clients. */
const NOT_A_CLIENT =
  /curl|wget|python-requests|httpx|aiohttp|scrapy|libwww|java\/|go-http-client|okhttp|postman|insomnia|headlesschrome|phantomjs|bot\b|spider|crawler|monitor|uptime|scanner/i;

/** One record per caller per day, and one that never expires. */
interface DayRecord {
  scrape: number;
  map: number;
  hosts: Record<string, number>;
}
interface EverRecord {
  sessions: number;
  actions: number;
  searches: number;
}

const emptyDay = (): DayRecord => ({ scrape: 0, map: 0, hosts: {} });
const emptyEver = (): EverRecord => ({ sessions: 0, actions: 0, searches: 0 });

export type FreeRefusal =
  | "no_counter"
  | "not_a_client"
  | "needs_key"
  | "format"
  | "scrape_today"
  | "map_today"
  | "host"
  | "robots"
  | "session_ever"
  | "actions_ever"
  | "searches_ever"
  | "searches_today"
  | "sessions_busy"
  | "global";

export interface FreeLeft {
  scrape: number;
  map: number;
  sessions: number;
  actions: number;
  searches: number;
}

export type FreeVerdict = { ok: true; left: FreeLeft } | { ok: false; reason: FreeRefusal };

export interface FreeCall {
  tool: string;
  /** List price, counted only against the global ceiling. */
  micros: number;
  url?: string;
  formats?: unknown;
  /** Free sessions open right now, across everybody. */
  sessionsOpen?: number;
}

async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const today = () => new Date().toISOString().slice(0, 10);

export function looksLikeClient(userAgent: string | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 3) return false;
  return !NOT_A_CLIENT.test(userAgent);
}

export function formatsNotFree(formats: unknown): Format[] {
  if (!Array.isArray(formats)) return [];
  return formats.filter((f): f is Format => typeof f === "string" && !FREE_FORMATS.has(f as Format));
}

/**
 * robots.txt, honoured on free calls only. The requests leave from our infrastructure, so
 * ignoring it would be our behaviour: whoever pays answers for themselves, whoever does not
 * answers to us.
 */
export async function robotsAllow(url: string): Promise<boolean> {
  try {
    const target = new URL(url);
    const res = await fetch(`${target.origin}/robots.txt`, {
      signal: AbortSignal.timeout(4_000),
      headers: { "user-agent": "oassis-api/1.0 (+https://oassis.dev)" },
    });
    if (!res.ok) return true;
    const text = (await res.text()).slice(0, 100_000);

    const groups = text.split(/^\s*user-agent:/im).slice(1);
    const wildcard = groups.find((g) => /^\s*\*/.test(g));
    if (!wildcard) return true;

    const path = `${target.pathname}${target.search}` || "/";
    for (const line of wildcard.split("\n")) {
      const rule = /^\s*disallow:\s*(\S*)/i.exec(line);
      if (!rule) continue;
      const prefix = rule[1] ?? "";
      if (prefix === "") continue;
      if (path.startsWith(prefix)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Decides a free call and, when it passes, spends it. Nothing is written until every check
 * has passed: a refusal must not cost the caller part of their day.
 */
export async function claimFreeCall(
  env: Env,
  caller: { ip: string; userAgent?: string },
  call: FreeCall,
): Promise<FreeVerdict> {
  if (!env.CACHE) return { ok: false, reason: "no_counter" };
  if (!FREE_TOOLS.has(call.tool)) return { ok: false, reason: "needs_key" };
  if (!looksLikeClient(caller.userAgent)) return { ok: false, reason: "not_a_client" };
  if (formatsNotFree(call.formats).length) return { ok: false, reason: "format" };

  const counters = await readCounters(env, caller.ip);
  const { day, ever } = counters;

  if (counters.globalSpent + call.micros > FREE_SPEND_GLOBAL_DAY) return { ok: false, reason: "global" };

  switch (call.tool) {
    case "web_scrape":
      if (day.scrape >= FREE_PER_DAY.scrape) return { ok: false, reason: "scrape_today" };
      break;
    case "web_map":
      if (day.map >= FREE_PER_DAY.map) return { ok: false, reason: "map_today" };
      break;
    case "web_session_open":
      if (ever.sessions >= FREE_EVER.sessions) return { ok: false, reason: "session_ever" };
      if ((call.sessionsOpen ?? 0) >= 3) return { ok: false, reason: "sessions_busy" };
      break;
    case "web_act":
      if (ever.actions >= FREE_EVER.actions) return { ok: false, reason: "actions_ever" };
      break;
    case "web_search_exa":
      if (ever.searches >= FREE_EVER.searches) return { ok: false, reason: "searches_ever" };
      break;
  }

  // The allowance above is per caller; this one is what the wallet can afford today.
  if (FREE_CASH_TOOLS.has(call.tool) && counters.cashSpent + call.micros > FREE_CASH_DAY) {
    return { ok: false, reason: "searches_today" };
  }

  if (call.url) {
    try {
      const host = new URL(call.url).host;
      if ((day.hosts[host] ?? 0) >= FREE_PER_HOST) return { ok: false, reason: "host" };
      if (!(await robotsAllow(call.url))) return { ok: false, reason: "robots" };
      day.hosts[host] = (day.hosts[host] ?? 0) + 1;
    } catch {
      /* an unparseable url fails later, on its own merits */
    }
  }

  if (call.tool === "web_scrape") day.scrape += 1;
  if (call.tool === "web_map") day.map += 1;
  if (call.tool === "web_session_open") ever.sessions += 1;
  if (call.tool === "web_act") ever.actions += 1;
  if (call.tool === "web_search_exa") ever.searches += 1;

  counters.globalSpent += call.micros;
  if (FREE_CASH_TOOLS.has(call.tool)) counters.cashSpent += call.micros;
  await writeCounters(env, counters, call.tool);

  return { ok: true, left: leftFrom(day, ever) };
}

const leftFrom = (day: DayRecord, ever: EverRecord): FreeLeft => ({
  scrape: FREE_PER_DAY.scrape - day.scrape,
  map: FREE_PER_DAY.map - day.map,
  sessions: FREE_EVER.sessions - ever.sessions,
  actions: FREE_EVER.actions - ever.actions,
  searches: FREE_EVER.searches - ever.searches,
});

/**
 * Gives a free call back.
 *
 * The counters are spent before the work runs, so when the work did not happen they are
 * the only thing there is to undo: a free caller has no balance to credit. Someone whose
 * ten free reads were eaten by our own failures has no reason to come back, which defeats
 * the point of having a free tier at all.
 *
 * Returns what the caller has again, because the answer that reports the failure is also
 * the one that tells them what is left: saying "you were not charged" while counting the
 * call against them contradicts itself in a single sentence.
 */
export async function releaseFreeCall(
  env: Env,
  caller: { ip: string },
  call: FreeCall,
): Promise<FreeLeft | null> {
  if (!env.CACHE) return null;

  const counters = await readCounters(env, caller.ip);
  const { day, ever } = counters;
  const back = (n: number) => Math.max(0, n - 1);

  if (call.tool === "web_scrape") day.scrape = back(day.scrape);
  if (call.tool === "web_map") day.map = back(day.map);
  if (call.tool === "web_session_open") ever.sessions = back(ever.sessions);
  if (call.tool === "web_act") ever.actions = back(ever.actions);
  if (call.tool === "web_search_exa") ever.searches = back(ever.searches);
  if (call.url) {
    try {
      const host = new URL(call.url).host;
      if (day.hosts[host]) day.hosts[host] = back(day.hosts[host]);
    } catch {
      /* an unparseable url was never counted */
    }
  }

  counters.globalSpent = Math.max(0, counters.globalSpent - call.micros);
  if (FREE_CASH_TOOLS.has(call.tool)) counters.cashSpent = Math.max(0, counters.cashSpent - call.micros);
  await writeCounters(env, counters, call.tool);
  return leftFrom(day, ever);
}

/** The three counters a keyless caller is measured against, under one fingerprint. */
interface Counters {
  dayKey: string;
  everKey: string;
  globalKey: string;
  cashKey: string;
  day: DayRecord;
  ever: EverRecord;
  globalSpent: number;
  cashSpent: number;
}

async function readCounters(env: Env, ip: string): Promise<Counters> {
  const cache = env.CACHE as KVNamespace;
  const who = await fingerprint(ip);
  const dayKey = `free:${today()}:${who}`;
  const everKey = `free:ever:${who}`;
  const globalKey = `free:spend:${today()}`;
  const cashKey = `free:cash:${today()}`;
  return {
    dayKey,
    everKey,
    globalKey,
    cashKey,
    day: ((await cache.get(dayKey, "json")) as DayRecord | null) ?? emptyDay(),
    ever: ((await cache.get(everKey, "json")) as EverRecord | null) ?? emptyEver(),
    globalSpent: Number((await cache.get(globalKey)) ?? 0) || 0,
    cashSpent: Number((await cache.get(cashKey)) ?? 0) || 0,
  };
}

async function writeCounters(env: Env, counters: Counters, tool: FreeCall["tool"]): Promise<void> {
  const cache = env.CACHE as KVNamespace;
  const twoDays = 2 * 24 * 60 * 60;
  await cache.put(counters.dayKey, JSON.stringify(counters.day), { expirationTtl: twoDays });
  await cache.put(counters.globalKey, String(counters.globalSpent), { expirationTtl: twoDays });
  if (FREE_CASH_TOOLS.has(tool)) {
    await cache.put(counters.cashKey, String(counters.cashSpent), { expirationTtl: twoDays });
  }
  if (tool === "web_session_open" || tool === "web_act" || tool === "web_search_exa") {
    // A year, which is as close to "ever" as a counter needs to be.
    await cache.put(counters.everKey, JSON.stringify(counters.ever), { expirationTtl: 365 * 24 * 60 * 60 });
  }
}

export interface FreeTableRow {
  api: string;
  tool: string;
  what: string;
  free: string;
  note?: string;
}

/** What a keyless caller gets, against the names of the endpoints they call. */
export function freeTable(): FreeTableRow[] {
  return [
    {
      api: "POST /web/v1/scrape",
      tool: "web_scrape",
      what: "Read a page or a document: markdown, html, links, controls, accessibility, elements",
      free: `${FREE_PER_DAY.scrape} a day`,
      note: `at most ${FREE_PER_HOST} pages of the same site`,
    },
    {
      api: "POST /web/v1/map",
      tool: "web_map",
      what: "List a site's urls, from its sitemap and its page",
      free: `${FREE_PER_DAY.map} a day`,
    },
    {
      api: "POST /web/v1/session",
      tool: "web_session_open",
      what: "Open a browser on a page and get its map of controls",
      free: `${FREE_EVER.sessions}, ever`,
      note: "the thing nobody else has: once is enough to see it",
    },
    {
      api: "POST /web/v1/act",
      tool: "web_act",
      what: "Click, type, select and wait on that session",
      free: `${FREE_EVER.actions}, ever`,
    },
    {
      api: "POST /web/v1/search/exa",
      tool: "web_search_exa",
      what: "Search the web with Exa's index",
      free: `${FREE_EVER.searches}, ever`,
      note: `paid to the provider in cash, so about ${Math.floor(FREE_CASH_DAY / 7000)} a day across everybody`,
    },
    {
      api: "POST /web/v1/crawl · /scrape/batch · scrape with `json`",
      tool: "web_crawl · web_scrape_batch",
      what: "Crawl a site, read a list of urls, extract with AI",
      free: "needs a key",
      note: "they answer with a job to poll, which demonstrates nothing to a first-time caller",
    },
    {
      api: "GET /crawl/:id · /scrape/batch/:id · DELETE session · POST /feedback",
      tool: "web_crawl_status · web_batch_status · web_session_close · web_feedback",
      what: "Collect or cancel a job, close a session, report a problem",
      free: "unlimited",
    },
    {
      api: "GET on any route · POST /mcp initialize · tools/list",
      tool: "—",
      what: "The document describing a route, and the MCP handshake",
      free: "unlimited",
    },
  ];
}

/** Every refusal says what happened and how to carry on: a bare no teaches nobody. */
export function explainRefusal(reason: FreeRefusal, price: string): string {
  const paying = [
    "Two ways to carry on:",
    `• Pay per call with a wallet and no account at all: POST the same request to the HTTP API and answer the 402 challenge (x402, USDC on Base). This call would be ${price}.`,
    "• Or use an API key in `Authorization: Bearer oas_…`.",
  ].join("\n");

  const reasons: Record<FreeRefusal, string> = {
    needs_key:
      "That one needs a key. Without one you can read pages and documents, list a site's urls, and try a browser session once — a crawl or a batch answers with a job to poll, which shows a first-time caller nothing.",
    format:
      "Without a key you can ask for markdown, html, links, controls, accessibility or elements. `json` calls a model, and `pdf` and `screenshot` are heavy renders: those need a key.",
    scrape_today: `${FREE_PER_DAY.scrape} free reads a day, and today's are used. They come back tomorrow.`,
    map_today: `${FREE_PER_DAY.map} free site listings a day, and today's are used.`,
    host: `Without a key you can read ${FREE_PER_HOST} pages of the same site per day. Reading a whole site is what /crawl is for.`,
    robots:
      "That site's robots.txt asks automated clients not to read this path, so it is not served on the free tier.",
    session_ever:
      "The free tier includes one browser session, and it has been used. It is given once rather than daily because it holds one of a handful of concurrent browsers — a seat that belongs to somebody paying.",
    actions_ever: `The free tier includes ${FREE_EVER.actions} actions on that one session, and they are used.`,
    searches_ever: `The free tier includes ${FREE_EVER.searches} searches in total. A search is bought from the provider on every call, which is why it is a lifetime allowance rather than a daily one.`,
    searches_today:
      "Free searches have used up today's budget across all callers. Unlike the rest of the free tier, each one is paid to the search provider in cash, so the day's worth is small. It resets tomorrow, and paid searches are unaffected.",
    sessions_busy:
      "All free session slots are busy right now. Paid sessions are unaffected — try again in a minute.",
    global: "The free tier has hit its ceiling for today across all callers. Paid calls are unaffected.",
    not_a_client:
      "The free tier is for MCP clients. This request arrived without a client name, or with the default of an HTTP library or crawler.",
    no_counter: "",
  };

  return `${reasons[reason]}\n${paying}`;
}
