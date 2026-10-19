/**
 * A batch job, in a Durable Object.
 *
 * A batch cannot be answered in one request —fifty pages do not fit, and the client
 * should not hold a connection open for minutes— so the work happens here, on an
 * alarm, and the caller collects it with the `jobId`.
 *
 * Two things this object is careful about:
 *
 * - **It works in small chunks.** Rendering fifty pages in one alarm would hit the
 *   Worker's limits halfway and lose what it had done. Each alarm takes a few urls,
 *   stores them, and schedules the next one.
 * - **It gives money back.** The batch is charged up front, per url. A url that
 *   fails outright was never a service, and a url served from the cache cost us no
 *   render, so both are refunded together when the job ends.
 */

import { DurableObject } from "cloudflare:workers";
import { refundJob } from "./refund";
import { JobUpdates } from "./serial";
import { PRICES, inDollars, scrapePrice } from "../billing/prices";
import { CachedRenderer } from "../cached-renderer";
import { cacheable } from "../cache";
import { QuickActionsRenderer } from "../quick-actions";
import { read } from "../scrape";
import type { BatchRequest } from "../schema";
import type { Env, Format, ScrapeResponse } from "../types";

/** Urls per alarm. Small enough to finish inside one invocation, with room to spare. */
const CHUNK = 3;

export type JobState = "queued" | "running" | "done" | "cancelled";

interface Stored {
  req: BatchRequest;
  account: string | null;
  chargedMicros: number;
  createdAt: number;
  finishedAt?: number;
  /** A claimed page is billed even if cancellation arrives while it is being read. */
  inFlight?: boolean;
  state: JobState;
  next: number;
  /** Micros still to give back: failed urls, plus what the cache saved. */
  refundMicros: number;
  /** Micros already given back. This is what the status reports. */
  refundedMicros: number;
}

interface UrlResult {
  url: string;
  ok: boolean;
  data?: ScrapeResponse["data"];
  errors?: ScrapeResponse["errors"];
  cached?: Format[];
  ms?: number;
}

export type JobMessage =
  | { kind: "create"; req: BatchRequest; account: string | null; chargedMicros: number }
  | { kind: "status"; limit?: number }
  | { kind: "cancel" };

export class BatchJob extends DurableObject<Env> {
  private readonly updates = new JobUpdates();

  fetch(request: Request): Promise<Response> {
    return this.updates.run(() => this.handle(request));
  }

  private async handle(request: Request): Promise<Response> {
    const message = (await request.json()) as JobMessage;
    const jobId = this.ctx.id.toString();

    if (message.kind === "create") {
      const stored: Stored = {
        req: message.req,
        account: message.account,
        chargedMicros: message.chargedMicros,
        createdAt: Date.now(),
        state: "queued",
        next: 0,
        refundMicros: 0,
        refundedMicros: 0,
      };
      await this.ctx.storage.put("job", stored);
      await this.ctx.storage.setAlarm(Date.now() + 100);
      return Response.json({
        jobId,
        status: "queued",
        total: message.req.urls.length,
        collect: `GET /tasks/v1/scrape/batch/${jobId}`,
      });
    }

    const job = await this.ctx.storage.get<Stored>("job");
    if (!job) return Response.json({ error: "not_found" }, { status: 404 });

    if (message.kind === "cancel") {
      if (job.state !== "done" && job.state !== "cancelled") {
        job.state = "cancelled";
        job.finishedAt = Date.now();
        // The urls never done are refunded: they were paid for and will not run.
        const pending = Math.max(0, job.req.urls.length - job.next - (job.inFlight ? 1 : 0));
        job.refundMicros += pending * scrapePrice(job.req.formats);
        await this.ctx.storage.put("job", job);
        await this.ctx.storage.deleteAlarm();
      }
      if (job.refundMicros > 0) await this.refund(job);
      return Response.json({ jobId, status: job.state, done: job.next, total: job.req.urls.length });
    }

    return Response.json(await this.status(jobId, job, message.limit ?? 50));
  }

  /**
   * Collecting a batch is free for the caller, so it has to be cheap for us: one key per
   * url meant a finished 50-url batch cost 51 storage reads per poll, and a client polling
   * every second billed us for standing still. The results are kept assembled under one
   * key, rewritten only when a url finishes.
   */
  private async status(jobId: string, job: Stored, limit: number) {
    const stored = (await this.ctx.storage.get<UrlResult[]>("results")) ?? [];
    const results = stored.slice(0, Math.min(job.next, limit));
    return {
      jobId,
      status: job.state,
      total: job.req.urls.length,
      completed: job.next,
      createdAt: new Date(job.createdAt).toISOString(),
      ...(job.finishedAt ? { finishedAt: new Date(job.finishedAt).toISOString() } : {}),
      // What has been given back, not what is still pending.
      refunded: inDollars(job.refundedMicros ?? 0),
      refundedMicros: job.refundedMicros ?? 0,
      results,
    };
  }

  /**
   * One chunk per alarm. What is already stored stays stored, so a failure in the
   * middle costs that chunk and not the whole job.
   */
  async alarm(): Promise<void> {
    const initial = await this.ctx.storage.get<Stored>("job");
    if (!initial) return;
    if (initial.state === "cancelled" || initial.state === "done") {
      await this.updates.run(async () => {
        const current = await this.ctx.storage.get<Stored>("job");
        if (current) await this.refund(current);
      });
      return;
    }
    const provider = new QuickActionsRenderer(this.env.BROWSER);
    for (let i = 0; i < CHUNK; i += 1) {
      const claimed = await this.updates.run(async () => {
        const job = await this.ctx.storage.get<Stored>("job");
        if (!job || job.state === "cancelled" || job.state === "done") return null;
        job.state = "running";
        job.inFlight = true;
        await this.ctx.storage.put("job", job);
        return job;
      });
      if (!claimed) return;
      const job = claimed;
      const url = job.req.urls[job.next]!;
      const req = { ...job.req, url } as unknown as Parameters<typeof read>[0];
      const renderer = cacheable(req) ? new CachedRenderer(this.env, provider, req.maxAge ?? 0) : provider;
      let res: ScrapeResponse | undefined;
      let error = "Page read failed";
      try { res = await read(req, renderer, this.env); }
      catch (e) { error = e instanceof Error ? e.message : String(e); }

      const terminal = await this.updates.run(async () => {
        // Cancellation may have happened during the browser request. Never write its stale snapshot.
        const job = (await this.ctx.storage.get<Stored>("job"))!;
        if (res) {
          const cached = res.metadata.cached ?? [];
          if (!res.success) job.refundMicros += scrapePrice(job.req.formats);
          else job.refundMicros += cached.reduce((sum, f) => sum + scrapePrice([f]) - PRICES.cacheHit, 0);
          await this.addResult({ url, ok: res.success, data: res.data, errors: res.errors,
            ...(cached.length ? { cached } : {}), ms: res.metadata.ms });
        } else {
          await this.addResult({ url, ok: false, errors: { markdown: error } as ScrapeResponse["errors"] });
          job.refundMicros += scrapePrice(job.req.formats);
        }
        job.next += 1;
        job.inFlight = false;
        if (job.state !== "cancelled" && (job.next >= job.req.urls.length)) {
          job.state = "done";
          job.finishedAt = Date.now();
        }
        await this.ctx.storage.put("job", job);
        if (job.state === "cancelled" || job.state === "done") {
          await this.refund(job);
          return true;
        }
        return false;
      });
      if (terminal) return;
    }
    await this.updates.run(async () => {
      const job = await this.ctx.storage.get<Stored>("job");
      if (job && job.state !== "cancelled" && job.state !== "done") await this.ctx.storage.setAlarm(Date.now() + 100);
    });
  }

  /**
   * One movement, at the end, so the account reads as one refund and not fifty. The
   * reason depends on how the job ended —urls that failed and renders the cache
   * saved, or urls a cancellation left unrun— and the jobId goes in as the reference,
   * so the movement can be traced back to its job.
   */
  /** Appends a result to the assembled list, the only place results are stored. */
  private async addResult(result: UrlResult): Promise<void> {
    const results = (await this.ctx.storage.get<UrlResult[]>("results")) ?? [];
    results.push(result);
    await this.ctx.storage.put("results", results);
  }

  private async refund(job: Stored): Promise<void> {
    if (!job.account || job.refundMicros <= 0) return;
    const amount = Math.min(job.refundMicros, job.chargedMicros - (job.refundedMicros ?? 0));
    if (amount <= 0) return;
    const why = job.state === "cancelled" ? "urls not run" : "failed urls and cache hits";
    try {
      await refundJob(this.env.BILLING, job.account, this.ctx.id.toString(), job.refundedMicros ?? 0, amount, `refund: batch (${why})`);
    } catch (e) {
      console.error(`batch refund failed: ${e}`);
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return;
    }
    job.refundMicros = 0;
    job.refundedMicros = (job.refundedMicros ?? 0) + amount;
    await this.ctx.storage.put("job", job);
  }
}
