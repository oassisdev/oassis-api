/**
 * A crawl, in a Durable Object.
 *
 * A crawl is a batch that feeds itself: every page read hands over the links to the
 * next ones. That is the whole difference, and it is why this reuses the batch's
 * discipline — chunks on an alarm, results stored as they come, and money back for
 * what was never read.
 *
 * It is charged up front for the pages it is *allowed* to read (`limit`), because the
 * price has to be known before the work. A crawl that finds twelve pages when it was
 * allowed thirty refunds the eighteen it never touched.
 */

import { DurableObject } from "cloudflare:workers";
import { credit } from "../billing/accounts";
import { PRICES, crawlPagePrice, inDollars } from "../billing/prices";
import { CachedRenderer } from "../cached-renderer";
import { cacheable } from "../cache";
import { keepUrl } from "../map";
import { QuickActionsRenderer } from "../quick-actions";
import { read } from "../scrape";
import type { CrawlRequest } from "../schema";
import type { Env, Format, ScrapeResponse } from "../types";

/** Pages per alarm. Each page is a render, so this stays small. */
const CHUNK = 2;

export type CrawlState = "queued" | "running" | "done" | "cancelled";

interface Frontier {
  url: string;
  depth: number;
}

interface Stored {
  req: CrawlRequest;
  account: string | null;
  chargedMicros: number;
  createdAt: number;
  finishedAt?: number;
  state: CrawlState;
  frontier: Frontier[];
  /** Pages already read, which is what decides when the limit is spent. */
  read: number;
  /**
   * Urls already read or queued. Kept here on purpose: rebuilding it by reading every
   * stored page on every hop cost one storage read per page per page — a 200-page crawl
   * spent tens of thousands of reads to answer a question the job already knew.
   */
  seen: string[];
  refundMicros: number;
  refundedMicros: number;
  discovered: number;
}

interface PageResult {
  url: string;
  depth: number;
  ok: boolean;
  data?: ScrapeResponse["data"];
  errors?: ScrapeResponse["errors"];
  cached?: Format[];
}

export type CrawlMessage =
  | { kind: "create"; req: CrawlRequest; account: string | null; chargedMicros: number }
  | { kind: "status"; limit?: number }
  | { kind: "cancel" };

export class CrawlJob extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const message = (await request.json()) as CrawlMessage;
    const jobId = this.ctx.id.toString();

    if (message.kind === "create") {
      const stored: Stored = {
        req: message.req,
        account: message.account,
        chargedMicros: message.chargedMicros,
        createdAt: Date.now(),
        state: "queued",
        frontier: [{ url: message.req.url, depth: 0 }],
        read: 0,
        seen: [message.req.url],
        refundMicros: 0,
        refundedMicros: 0,
        discovered: 1,
      };
      await this.ctx.storage.put("job", stored);
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return Response.json({
        jobId,
        status: "queued",
        limit: message.req.limit,
        maxDepth: message.req.maxDepth,
        collect: `GET /web/v1/crawl/${jobId}`,
      });
    }

    const job = await this.ctx.storage.get<Stored>("job");
    if (!job) return Response.json({ error: "not_found" }, { status: 404 });

    if (message.kind === "cancel") {
      if (job.state !== "done" && job.state !== "cancelled") {
        job.state = "cancelled";
        job.finishedAt = Date.now();
        await this.ctx.storage.deleteAlarm();
        job.refundMicros += this.unreadMicros(job);
        await this.ctx.storage.put("job", job);
        await this.refund(job);
      }
      return Response.json(await this.status(jobId, job, 50));
    }

    return Response.json(await this.status(jobId, job, message.limit ?? 50));
  }

  /** Pages paid for and never read. */
  private unreadMicros(job: Stored): number {
    return Math.max(0, job.req.limit - job.read) * crawlPagePrice(job.req.formats);
  }

  /**
   * Collecting a crawl is free for the caller, so it has to be cheap to serve: reading the
   * pages one key at a time meant a finished 50-page crawl cost 51 storage reads on every
   * poll, and a client polling once a second never stopped paying for it. The pages are
   * kept assembled under one key, rewritten only when a page is added.
   */
  private async pages(job: Stored, limit: number): Promise<PageResult[]> {
    const all = (await this.ctx.storage.get<PageResult[]>("pages")) ?? [];
    return all.slice(0, Math.min(job.read, limit));
  }

  private async status(jobId: string, job: Stored, limit: number) {
    const pages = await this.pages(job, limit);
    return {
      jobId,
      status: job.state,
      limit: job.req.limit,
      maxDepth: job.req.maxDepth,
      read: job.read,
      discovered: job.discovered,
      queued: job.frontier.length,
      createdAt: new Date(job.createdAt).toISOString(),
      ...(job.finishedAt ? { finishedAt: new Date(job.finishedAt).toISOString() } : {}),
      refunded: inDollars(job.refundedMicros),
      refundedMicros: job.refundedMicros,
      pages,
    };
  }

  async alarm(): Promise<void> {
    const job = await this.ctx.storage.get<Stored>("job");
    if (!job || job.state === "cancelled" || job.state === "done") return;

    job.state = "running";
    const provider = new QuickActionsRenderer(this.env.BROWSER);
    // The links are always read: without them a crawl has nowhere to go next. They
    // are part of the page price, and they are returned to the caller too.
    const formats = [...new Set<Format>([...job.req.formats, "links"])];

    for (let i = 0; i < CHUNK && job.frontier.length > 0 && job.read < job.req.limit; i += 1) {
      const next = job.frontier.shift() as Frontier;
      const req = { ...job.req, url: next.url, formats } as unknown as Parameters<typeof read>[0];
      const renderer = cacheable(req) ? new CachedRenderer(this.env, provider, req.maxAge ?? 0) : provider;

      try {
        const res = await read(req, renderer, this.env);
        const cached = res.metadata.cached ?? [];
        if (cached.length) {
          job.refundMicros += cached.length * (crawlPagePrice(job.req.formats) / formats.length - PRICES.cacheHit);
        }
        if (!res.success) job.refundMicros += crawlPagePrice(job.req.formats);

        await this.addPage({
          url: next.url,
          depth: next.depth,
          ok: res.success,
          data: res.data,
          errors: res.errors,
          ...(cached.length ? { cached } : {}),
        });

        // Where to go next: the links of this page, one level deeper.
        if (next.depth < job.req.maxDepth && Array.isArray(res.data.links)) {
          const known = new Set(job.seen);

          for (const candidate of res.data.links as unknown[]) {
            if (typeof candidate !== "string") continue;
            const kept = keepUrl(candidate, { ...job.req, url: job.req.url } as never);
            if (!kept || known.has(kept)) continue;
            // Never queue more than the limit could ever read: a frontier of ten
            // thousand urls is storage we pay for and never use.
            if (job.frontier.length + job.read >= job.req.limit * 2) break;
            job.frontier.push({ url: kept, depth: next.depth + 1 });
            known.add(kept);
            job.seen.push(kept);
            job.discovered += 1;
          }
        }
      } catch (e) {
        await this.addPage({
          url: next.url,
          depth: next.depth,
          ok: false,
          errors: { markdown: e instanceof Error ? e.message : String(e) } as ScrapeResponse["errors"],
        });
        job.refundMicros += crawlPagePrice(job.req.formats);
      }

      job.read += 1;
      await this.ctx.storage.put("job", job);
    }

    if (job.frontier.length === 0 || job.read >= job.req.limit) {
      job.state = "done";
      job.finishedAt = Date.now();
      // A crawl that ran out of links before running out of budget did not use what
      // it was charged for.
      job.refundMicros += this.unreadMicros(job);
      await this.ctx.storage.put("job", job);
      await this.refund(job);
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + 100);
  }

  /** Appends a page to the assembled list, which is the only place pages are stored. */
  private async addPage(page: PageResult): Promise<void> {
    const pages = (await this.ctx.storage.get<PageResult[]>("pages")) ?? [];
    pages.push(page);
    await this.ctx.storage.put("pages", pages);
  }

  /** One entry at the end, with the jobId as its reference. */
  private async refund(job: Stored): Promise<void> {
    if (!job.account || job.refundMicros <= 0) return;
    const amount = Math.min(job.refundMicros, job.chargedMicros - job.refundedMicros);
    if (amount <= 0) return;
    const why = job.state === "cancelled" ? "cancelled" : "pages not read, failures and cache hits";
    try {
      await credit(this.env.BILLING, job.account, amount, `refund: crawl (${why})`, this.ctx.id.toString());
    } catch (e) {
      console.error(`crawl refund failed: ${e}`);
      return;
    }
    job.refundMicros = 0;
    job.refundedMicros += amount;
    await this.ctx.storage.put("job", job);
  }
}
