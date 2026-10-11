/**
 * The agent task service: what HTTP and MCP both call. Validation, idempotency, the reservation,
 * the reading of a task, and cancellation live here once, so the two doors cannot disagree.
 */

import { inDollars } from "../billing/prices";
import type { Env } from "../types";
import { reserveTask } from "./billing";
import { DEFAULT_MODEL } from "./rates";
import { taskRequest, checkPublicUrl } from "./request";
import type { TaskDocument } from "./executor";

export const TERMINAL = ["completed", "partial", "failed", "cancelled"] as const;
/** A queued task this old has probably lost its alarm; starting it again is harmless. */
const KICK_AFTER_MS = 30_000;

export type ServiceError = { status: number; error: string; message: string; details?: unknown };

export interface StartInput {
  account: string;
  body: unknown;
  idempotencyKey: string | null;
  baseUrl: string;
}

export type StartResult =
  | { ok: true; created: boolean; taskId: string; status: string; location: string }
  | { ok: false; error: ServiceError };

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The same request, however its keys were ordered, has the same hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function initialDocument(req: ReturnType<typeof taskRequest.parse>): TaskDocument {
  return {
    task: req.task,
    mode: req.mode,
    urls: req.urls,
    limits: {
      max_cost_micros: Math.round(req.limits.max_cost_usd * 1_000_000),
      max_duration_ms: req.limits.max_duration_seconds * 1_000,
      max_steps: req.limits.max_steps,
    },
    status: "queued",
    started_at: null,
    steps: 0,
    invalid_plans: 0,
    spent_micros: 0,
    inflight: null,
    operations: [],
    candidates: [],
    read_urls: [],
    sources: [],
    result: null,
    missing: [],
    limit_hit: null,
    dropped_findings: 0,
    cancel_requested: false,
    error_code: null,
  };
}

export async function startTask(env: Env, input: StartInput): Promise<StartResult> {
  const parsed = taskRequest.safeParse(input.body);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        status: 400,
        error: "invalid_request",
        message: "The request does not match the task contract.",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  }
  const req = parsed.data;
  for (const u of req.urls) {
    const why = checkPublicUrl(u);
    if (why) return { ok: false, error: { status: 400, error: why, message: "This url cannot be read by an agent task." } };
  }
  if (input.idempotencyKey !== null && !/^[A-Za-z0-9._:-]{1,200}$/.test(input.idempotencyKey)) {
    return { ok: false, error: { status: 400, error: "invalid_idempotency_key", message: "Idempotency-Key must be 1 to 200 characters: letters, digits, '.', '_', ':' or '-'." } };
  }

  const hash = await sha256(canonical(req));
  const existing = input.idempotencyKey ? await findByKey(env, input.account, input.idempotencyKey) : null;
  if (existing) return existing.request_hash === hash ? started(input, existing.id, existing.status, false) : conflict();

  const taskId = crypto.randomUUID();
  const doc = initialDocument(req);
  const micros = doc.limits.max_cost_micros;
  const outcome = await reserveTask(env.BILLING, {
    taskId,
    account: input.account,
    micros,
    now: Date.now(),
    task: {
      mode: req.mode,
      request: JSON.stringify(req),
      requestHash: hash,
      idempotencyKey: input.idempotencyKey,
      document: JSON.stringify(doc),
    },
  });
  if (outcome === "insufficient") {
    return { ok: false, error: { status: 402, error: "insufficient_balance", message: `The task reserves up to ${inDollars(micros)} before it starts, and the available balance does not cover it.` } };
  }
  if (outcome === "duplicate") {
    const again = input.idempotencyKey ? await findByKey(env, input.account, input.idempotencyKey) : null;
    return again && again.request_hash === hash ? started(input, again.id, again.status, false) : conflict();
  }

  await kick(env, taskId);
  return started(input, taskId, "queued", true);
}

function started(input: StartInput, id: string, status: string, created: boolean): StartResult {
  return { ok: true, created, taskId: id, status, location: `${input.baseUrl}/agent/v1/tasks/${id}` };
}

function conflict(): StartResult {
  return { ok: false, error: { status: 409, error: "idempotency_conflict", message: "This Idempotency-Key was already used with a different request." } };
}

async function findByKey(env: Env, account: string, key: string): Promise<{ id: string; request_hash: string; status: string } | null> {
  return env.BILLING.prepare(`SELECT id, request_hash, status FROM agent_tasks WHERE account = ?1 AND idempotency_key = ?2`)
    .bind(account, key)
    .first<{ id: string; request_hash: string; status: string }>();
}

/** Wakes the task's object. The object is idempotent, so waking it twice is harmless. */
export async function kick(env: Env, taskId: string, path = "/start"): Promise<void> {
  const stub = env.AGENT_TASKS.get(env.AGENT_TASKS.idFromName(taskId));
  await stub.fetch("https://task.internal" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId, model: env.AGENT_MODEL ?? DEFAULT_MODEL }),
  });
}

interface Row {
  id: string;
  status: string;
  mode: string;
  request: string;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
  reserved_micros: number;
  spent_micros: number;
  released_micros: number;
  settlement: string;
  document: string;
  error_code: string | null;
}

async function rowFor(env: Env, account: string, id: string): Promise<Row | null> {
  return env.BILLING.prepare(`SELECT * FROM agent_tasks WHERE id = ?1 AND account = ?2`).bind(id, account).first<Row>();
}

export async function getTask(env: Env, account: string, id: string): Promise<ServiceError | { status: 200; body: unknown }> {
  const row = await rowFor(env, account, id);
  if (!row) return { status: 404, error: "not_found", message: "No task with that id belongs to this account." };
  if (row.status === "queued" && Date.now() - row.created_at > KICK_AFTER_MS) await kick(env, id).catch(() => null);
  return { status: 200, body: view(row) };
}

export async function cancelTask(env: Env, account: string, id: string): Promise<ServiceError | { status: number; body: unknown }> {
  const row = await rowFor(env, account, id);
  if (!row) return { status: 404, error: "not_found", message: "No task with that id belongs to this account." };
  if ((TERMINAL as readonly string[]).includes(row.status)) return { status: 200, body: view(row) };
  await env.BILLING.prepare(
    `UPDATE agent_tasks SET cancel_requested = 1, updated_at = ?3
      WHERE id = ?1 AND account = ?2 AND status IN ('queued', 'running')`,
  )
    .bind(id, account, Date.now())
    .run();
  await kick(env, id, "/cancel").catch(() => null);
  const after = (await rowFor(env, account, id)) ?? row;
  return { status: 202, body: view(after) };
}

/** What a caller may see. Internal detail, provider messages and secrets are not in it. */
export function view(row: Row): unknown {
  const doc = JSON.parse(row.document) as TaskDocument;
  const settled = row.settlement === "settled";
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    finished_at: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    progress: {
      steps: doc.steps,
      max_steps: doc.limits.max_steps,
      operations: doc.operations.map((o) => ({
        step: o.step,
        op: o.op,
        ok: o.ok,
        // Failures are described in one word: the provider's own text can contain details we do not show.
        detail: o.ok ? o.detail : "failed",
        charged: inDollars(o.micros),
      })),
    },
    result: row.status === "completed" || row.status === "partial" ? doc.result : null,
    sources: doc.sources.map((s) => ({ id: s.id, url: s.url, retrieved_at: s.retrieved_at, evidence: s.evidence, truncated: s.truncated })),
    limitations: doc.missing,
    findings_removed: doc.dropped_findings,
    limit_hit: doc.limit_hit,
    reason: row.error_code,
    billing: {
      reserved: inDollars(row.reserved_micros),
      spent: inDollars(settled ? row.spent_micros : doc.spent_micros),
      released: settled ? inDollars(row.released_micros) : null,
      settlement: row.settlement,
    },
  };
}

