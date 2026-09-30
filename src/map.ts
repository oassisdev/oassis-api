/**
 * `map`: every url of a site, fast.
 *
 * Two sources, and the cheap one first. The sitemap is plain HTTP —no browser at all— and
 * a site that keeps one hands over thousands of urls in a single request. The rendered
 * page only adds what the sitemap missed.
 *
 * This is the door into crawling: whoever wants to crawl a site maps it first to see
 * what is there, and mapping is orders of magnitude cheaper than rendering it.
 */

import type { MapRequest } from "./schema";

/**
 * Caps, so one call cannot turn into a scan of a whole sitemap index. The collector
 * stops as soon as it has what the caller asked for, so a small `limit` is also a
 * fast, cheap call.
 */
const MAX_SITEMAPS = 12;
const FETCH_TIMEOUT_MS = 8_000;

export interface MapResult {
  /** The urls returned, cut to `limit`. */
  urls: string[];
  /** Unique urls found before the limit was applied. */
  discovered: number;
  /** Where the discovered ones came from: it explains the count and the price. */
  sources: { sitemap: number; page: number };
  sitemaps: string[];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "oassis-api/1.0 (+https://oassis.dev)" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Sitemaps declared in robots.txt, falling back to the conventional location. */
async function findSitemaps(origin: string): Promise<string[]> {
  const robots = await fetchText(`${origin}/robots.txt`);
  const declared = robots
    ? [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!).slice(0, MAX_SITEMAPS)
    : [];
  return declared.length ? declared : [`${origin}/sitemap.xml`];
}

const LOC = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

/**
 * Urls out of a sitemap, **filtered as they are collected**.
 *
 * The order matters: filtering afterwards means a cap cuts the list long before the
 * urls that match, so a map of one section comes back empty on a site full of it. A
 * url has to be wanted to take up a slot, and the collector stops once there are
 * enough.
 *
 * A sitemap index points at more sitemaps; those are followed one level only. Deeper
 * than that is a crawl, and a crawl is billed.
 */
async function urlsFromSitemaps(
  origin: string,
  keep: (url: string) => string | null,
  want: number,
): Promise<{ urls: string[]; seen: string[] }> {
  const seen: string[] = [];
  const kept = new Set<string>();
  const queue = [...(await findSitemaps(origin))];

  while (queue.length > 0 && kept.size < want && seen.length < MAX_SITEMAPS) {
    const sitemap = queue.shift() as string;
    const xml = await fetchText(sitemap);
    if (!xml) continue;
    seen.push(sitemap);

    const locs = [...xml.matchAll(LOC)].map((m) => m[1]!);
    if (/<sitemapindex/i.test(xml)) {
      // Children go to the back of the queue: breadth first, so one enormous child
      // does not use up the whole budget.
      queue.push(...locs);
      continue;
    }
    for (const loc of locs) {
      const wanted = keep(loc);
      if (wanted) kept.add(wanted);
      if (kept.size >= want) break;
    }
  }
  return { urls: [...kept], seen };
}

/** Keeps what belongs to the site and what the caller asked for. */
export function keepUrl(candidate: string, req: MapRequest): string | null {
  let url: URL;
  try {
    url = new URL(candidate, req.url);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = new URL(req.url).host;
  const sameSite = req.includeSubdomains
    ? url.host === host || url.host.endsWith(`.${host.replace(/^www\./, "")}`)
    : url.host === host;
  if (!sameSite) return null;

  const path = `${url.pathname}${url.search}`;
  if (req.includePaths?.length && !req.includePaths.some((p) => path.includes(p))) return null;
  if (req.excludePaths?.some((p) => path.includes(p))) return null;
  if (req.search && !`${path}${url.hash}`.toLowerCase().includes(req.search.toLowerCase())) return null;

  // The fragment is not a different page.
  url.hash = "";
  return url.toString();
}

/**
 * Maps a site: sitemap plus, when asked for, the links on the page itself. The page
 * is the only part that costs a render, so it is opt-out.
 */
export async function mapSite(
  req: MapRequest,
  linksFromPage: () => Promise<string[]>,
): Promise<MapResult> {
  const origin = new URL(req.url).origin;
  const found = new Set<string>();
  const sources = { sitemap: 0, page: 0 };

  // The page can add urls the sitemap does not list, so the sitemap is asked for a
  // little more than the limit when the page is coming too.
  const sitemap = await urlsFromSitemaps(origin, (u) => keepUrl(u, req), req.limit);
  for (const candidate of sitemap.urls) {
    if (!found.has(candidate)) {
      found.add(candidate);
      sources.sitemap += 1;
    }
  }

  if (req.includePage !== false) {
    try {
      for (const candidate of await linksFromPage()) {
        const kept = keepUrl(candidate, req);
        if (kept && !found.has(kept)) {
          found.add(kept);
          sources.page += 1;
        }
      }
    } catch {
      // A page that will not render does not void a sitemap that already answered.
    }
  }

  return {
    urls: [...found].slice(0, req.limit),
    discovered: found.size,
    sources,
    sitemaps: sitemap.seen,
  };
}
