/**
 * The keyless MCP trial permits scrape and map only, within 100 credits.
 * Trial accounting and paid-tool selection live in mcp.ts and billing/trial.ts.
 *
 * What is left is what protects the service rather than what limits the caller: a client
 * must say what it is, a site's robots.txt is respected on free reads, and browser sessions
 * are shared capacity. Over HTTP none of this applies, because every HTTP call is paid.
 */

/** Tools a keyless MCP caller cannot use: each one is bought from somebody else. */
export const PAID_OVER_MCP: ReadonlySet<string> = new Set();

/** Browser sessions open at once across keyless callers. A capacity, not a quota. */
export const FREE_SESSION_SLOTS = Infinity;

/** Free answers accept an hour-old cache: a swarm on the same pages costs one render. */


/** Defaults of HTTP libraries and crawlers: the free tier is for MCP clients. */
const NOT_A_CLIENT =
  /curl|wget|python-requests|httpx|aiohttp|scrapy|libwww|java\/|go-http-client|okhttp|postman|insomnia|headlesschrome|phantomjs|bot\b|spider|crawler|monitor|uptime|scanner/i;

export type FreeRefusal = "not_a_client" | "paid_search" | "robots" | "sessions_busy";

export interface FreeCall {
  tool: string;
  url?: string;
  urls?: string[];
  /** Free sessions open right now, across everybody. */
  sessionsOpen?: number;
}

export function looksLikeClient(userAgent: string | undefined): boolean {
  if (!userAgent || userAgent.trim().length < 3) return false;
  return !NOT_A_CLIENT.test(userAgent);
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

/** Why a keyless MCP call cannot run, or null when it can. */
export async function checkFreeCall(
  caller: { userAgent?: string },
  call: FreeCall,
): Promise<FreeRefusal | null> {
  void caller;


  const targets = [call.url, ...(call.urls ?? [])].filter((u): u is string => typeof u === "string");
  const allowed = await Promise.all(targets.map((u) => robotsAllow(u)));
  if (allowed.includes(false)) return "robots";
  return null;
}

/** Every refusal says what happened and how to carry on: a bare no teaches nobody. */
export function explainRefusal(reason: FreeRefusal, price: string): string {
  if (reason === "paid_search") {
    return [
      `web_search_exa is paid, not free: each search costs ${price}, which is the price Exa charges, passed through.`,
      "Two ways to carry on:",
      "• Pay per call with a wallet and no account at all: POST the same request to /web/v1/search over HTTP and answer the 402 challenge (x402, USDC on Base).",
      "• Or use an API key in `Authorization: Bearer oas_…`.",
    ].join("\n");
  }
  const reasons: Record<Exclude<FreeRefusal, "paid_search">, string> = {
    not_a_client:
      "The free tier over MCP is for MCP clients. This request arrived without a client name, or with the default of an HTTP library or crawler. Send your client's own User-Agent.",
    robots:
      "That site's robots.txt asks automated clients not to read this path, so the free tier does not read it. Paying per call over HTTP reads it on your own responsibility.",
    sessions_busy:
      "All free browser sessions are in use right now. Try again in a minute, or pay per call over HTTP, which is not affected.",
  };
  return reasons[reason];
}
