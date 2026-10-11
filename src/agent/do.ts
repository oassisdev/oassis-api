/**
 * The object that runs one task. It holds no state of its own: the task document lives in D1
 * and every step reads it, advances it by one step, and writes it back. That is what lets a
 * restart or a retried alarm continue the task instead of starting it again.
 */

import { DurableObject } from "cloudflare:workers";
import { search } from "../search/exa";
import { read } from "../scrape";
import { QuickActionsRenderer } from "../quick-actions";
import { scrapeRequest } from "../schema";
import type { Env } from "../types";
import { settleTask } from "./billing";
import { runStep, searchFailure, type Deps, type TaskDocument } from "./executor";
import { planNextStep, synthesize } from "./model";
import { DEFAULT_MODEL } from "./rates";

const STEP_GAP_MS = 250;

export class AgentTask extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== "/start" && path !== "/cancel") return new Response("not found", { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { taskId?: string; model?: string };
    if (body.taskId) await this.ctx.storage.put("taskId", body.taskId);
    if (body.model) await this.ctx.storage.put("model", body.model);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 202 });
  }

  async alarm(): Promise<void> {
    const taskId = await this.ctx.storage.get<string>("taskId");
    if (!taskId) return;
    const model = (await this.ctx.storage.get<string>("model")) ?? this.env.AGENT_MODEL ?? DEFAULT_MODEL;

    const row = await this.env.BILLING.prepare(
      `SELECT id, account, status, settlement, document, reserved_micros, cancel_requested FROM agent_tasks WHERE id = ?1`,
    )
      .bind(taskId)
      .first<{ id: string; account: string; status: string; settlement: string; document: string; reserved_micros: number; cancel_requested: number }>();
    if (!row || row.settlement === "settled") return;

    const doc = JSON.parse(row.document) as TaskDocument;
    if (row.cancel_requested) doc.cancel_requested = true;

    const done = await runStep(doc, this.deps(taskId, model));
    await this.save(taskId, doc);

    if (done) {
      await settleTask(this.env.BILLING, {
        taskId,
        account: row.account,
        spentMicros: doc.spent_micros,
        now: Date.now(),
        finalStatus: doc.status,
        finishedAt: Date.now(),
        document: JSON.stringify(doc),
        errorCode: doc.error_code,
        errorMessage: null,
      });
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + STEP_GAP_MS);
  }

  private async save(taskId: string, doc: TaskDocument): Promise<void> {
    await this.env.BILLING.prepare(
      `UPDATE agent_tasks SET document = ?2, status = ?3, spent_micros = ?4, updated_at = ?5
        WHERE id = ?1 AND settlement = 'pending'`,
    )
      .bind(taskId, JSON.stringify(doc), doc.status, doc.spent_micros, Date.now())
      .run();
  }

  private deps(taskId: string, model: string): Deps {
    const env = this.env;
    const network = env.X402_NETWORK === "base-sepolia" ? "eip155:84532" : "eip155:8453";
    const asset = network === "eip155:8453" ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    return {
      now: () => Date.now(),
      checkpoint: async (doc) => this.save(taskId, doc),
      plan: (doc) => planNextStep(env.AI, doc, model),
      search: async (query, maxExaMicros) => {
        try {
          const out = await search(env, { query, limit: 5 }, { maxMicros: maxExaMicros, network, asset });
          return { ok: true, results: out.results, paidMicros: out.paidMicros };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return { ok: false, error: message, ...searchFailure(message, maxExaMicros) };
        }
      },
      read: async (url) => {
        try {
          const req = scrapeRequest.parse({ url, formats: ["markdown"] });
          const res = await read(req, new QuickActionsRenderer(env.BROWSER), env);
          const markdown = res.success ? (res.data.markdown as string | undefined) : undefined;
          return markdown ? { ok: true, markdown } : { ok: false, error: "no content" };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      synthesize: (doc) => synthesize(env.AI, doc, model),
    };
  }
}
