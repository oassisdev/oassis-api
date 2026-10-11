/**
 * Runs one step of an agent task. The step is a pure function of the task document and the
 * dependencies it is given, so the same code runs in the Durable Object, in the tests, and
 * after a restart. Every paid operation is announced in the document before it starts, so a
 * crash in the middle leaves a marker that recovery can see, and recovery charges it rather
 * than guessing.
 */

import { CLIENT, STEP_RESERVE_MICROS, SYNTHESIS_RESERVE_MICROS, searchClientMicros } from "./rates";
import { MAX_CONTEXT_CHARS, MAX_SOURCES, decideStatus, verifyResult, truncateEvidence, type Source, type TaskResult } from "./contract";
import { checkPublicUrl } from "./request";

export type Status = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type OpKind = "plan" | "search" | "read" | "synthesis";

export interface Operation {
  step: number;
  op: OpKind;
  ok: boolean;
  detail: string;
  micros: number;
}

export interface TaskDocument {
  task: string;
  mode: "research";
  urls: string[];
  limits: { max_cost_micros: number; max_duration_ms: number; max_steps: number };
  status: Status;
  started_at: number | null;
  steps: number;
  invalid_plans: number;
  spent_micros: number;
  inflight: null | { op: OpKind; micros: number; detail: string };
  operations: Operation[];
  candidates: { url: string; title: string }[];
  read_urls: string[];
  sources: Source[];
  result: TaskResult | null;
  missing: string[];
  limit_hit: string | null;
  dropped_findings: number;
  cancel_requested: boolean;
  error_code: string | null;
}

export type Plan =
  | { action: "search"; query: string; reason: string }
  | { action: "read"; url: string; reason: string }
  | { action: "finish"; reason: string };

export type SearchOutcome =
  | { ok: true; results: { title: string; url: string; snippet?: string }[]; paidMicros: number }
  /** `certain`: nothing was paid (the challenge was refused before signing), so nothing is owed. */
  | { ok: false; error: string; certain: boolean; paidMicros: number };

/**
 * How a failed search is classified. A refusal before anything was signed, or a deployment that
 * cannot pay at all, owes nothing. Anything else may have reached the provider's payment step,
 * so the most it could have cost is owed.
 */
export function searchFailure(message: string, maxExaMicros: number): { certain: boolean; paidMicros: number } {
  const certain = /nothing was paid|is not configured/.test(message);
  return { certain, paidMicros: certain ? 0 : maxExaMicros };
}

export interface Deps {
  now(): number;
  /** Called before each paid operation, so the marker survives a crash. */
  checkpoint(doc: TaskDocument): Promise<void>;
  plan(doc: TaskDocument): Promise<Plan | null>;
  search(query: string, maxExaMicros: number): Promise<SearchOutcome>;
  read(url: string): Promise<{ ok: true; markdown: string } | { ok: false; error: string }>;
  synthesize(doc: TaskDocument): Promise<TaskResult | null>;
}

const MAX_INVALID_PLANS = 3;

export function remaining(doc: TaskDocument): number {
  return doc.limits.max_cost_micros - doc.spent_micros;
}

function charge(doc: TaskDocument, op: OpKind, micros: number, step: number, ok: boolean, detail: string): void {
  doc.spent_micros += micros;
  doc.operations.push({ step, op, ok, detail, micros });
}

/** Recovery: an operation announced but never recorded as finished. Its outcome is unknown, so it is charged. */
export function recoverUncertain(doc: TaskDocument): TaskDocument {
  if (!doc.inflight) return doc;
  const { op, micros, detail } = doc.inflight;
  charge(doc, op, micros, doc.steps, false, `${detail}: outcome unknown after a restart`);
  doc.inflight = null;
  doc.missing.push(`${op}_outcome_unknown`);
  doc.limit_hit = "operation_uncertain";
  return doc;
}

/**
 * Advances the task by one step, or finishes it. Returns true when the task reached a final
 * status. Nothing here decides a status from the model's own words: the status comes from
 * decideStatus over the evidence that was really read.
 */
export async function runStep(doc: TaskDocument, deps: Deps): Promise<boolean> {
  if (doc.status === "completed" || doc.status === "partial" || doc.status === "failed" || doc.status === "cancelled") {
    return true;
  }
  if (doc.started_at === null) doc.started_at = deps.now();
  doc.status = "running";

  if (doc.inflight) {
    recoverUncertain(doc);
    return finish(doc, deps);
  }

  if (doc.cancel_requested) return finish(doc, deps, "cancelled");
  if (deps.now() - doc.started_at >= doc.limits.max_duration_ms) {
    doc.limit_hit = "duration";
    return finish(doc, deps);
  }
  if (doc.steps >= doc.limits.max_steps) {
    doc.limit_hit = "steps";
    return finish(doc, deps);
  }
  if (remaining(doc) < STEP_RESERVE_MICROS + SYNTHESIS_RESERVE_MICROS) {
    doc.limit_hit = "cost";
    return finish(doc, deps);
  }

  const step = doc.steps + 1;
  doc.steps = step;

  doc.inflight = { op: "plan", micros: CLIENT.planMicros, detail: `step ${step}` };
  await deps.checkpoint(doc);
  const plan = await deps.plan(doc);
  // A planning call that gave no usable step is not billed: a failed call costs nothing.
  charge(doc, "plan", plan ? CLIENT.planMicros : 0, step, plan !== null, plan ? plan.action : "no valid plan");
  doc.inflight = null;

  if (plan === null) {
    doc.invalid_plans += 1;
    if (doc.invalid_plans >= MAX_INVALID_PLANS) {
      doc.missing.push("planner_invalid");
      return finish(doc, deps);
    }
    await deps.checkpoint(doc);
    return false;
  }

  if (plan.action === "finish") return finish(doc, deps);

  if (plan.action === "search") {
    const exaBudget = Math.floor((remaining(doc) - STEP_RESERVE_MICROS - SYNTHESIS_RESERVE_MICROS) / 2);
    if (exaBudget <= 0 || doc.sources.length >= MAX_SOURCES) {
      doc.missing.push(`search_not_run: ${plan.query.slice(0, 80)}`);
      await deps.checkpoint(doc);
      return false;
    }
    const maxExa = exaBudget;
    const announced = searchClientMicros(maxExa);
    doc.inflight = { op: "search", micros: announced, detail: plan.query.slice(0, 80) };
    await deps.checkpoint(doc);
    const out = await deps.search(plan.query, maxExa);
    if (out.ok) {
      const owed = searchClientMicros(out.paidMicros);
      charge(doc, "search", owed, step, true, `${out.results.length} results`);
      for (const r of out.results) {
        if (!doc.candidates.some((c) => c.url === r.url)) doc.candidates.push({ url: r.url, title: r.title });
      }
    } else {
      const owed = out.certain ? 0 : searchClientMicros(out.paidMicros);
      charge(doc, "search", owed, step, false, out.error.slice(0, 160));
    }
    doc.inflight = null;
    await deps.checkpoint(doc);
    return false;
  }

  // read
  const allowed = new Set([...doc.urls, ...doc.candidates.map((c) => c.url)]);
  const bad = checkPublicUrl(plan.url);
  if (!allowed.has(plan.url) || bad || doc.read_urls.includes(plan.url)) {
    doc.invalid_plans += 1;
    if (doc.invalid_plans >= MAX_INVALID_PLANS) {
      doc.missing.push("planner_invalid");
      return finish(doc, deps);
    }
    await deps.checkpoint(doc);
    return false;
  }
  if (doc.sources.length >= MAX_SOURCES) {
    doc.missing.push("source_limit");
    return finish(doc, deps);
  }
  if (remaining(doc) < CLIENT.pageMicros + SYNTHESIS_RESERVE_MICROS) {
    doc.limit_hit = "cost";
    return finish(doc, deps);
  }

  doc.inflight = { op: "read", micros: CLIENT.pageMicros, detail: plan.url };
  await deps.checkpoint(doc);
  const page = await deps.read(plan.url);
  doc.read_urls.push(plan.url);
  if (page.ok) {
    const t = truncateEvidence(page.markdown);
    const id = `s${doc.sources.length + 1}`;
    doc.sources.push({ id, url: plan.url, retrieved_at: new Date(deps.now()).toISOString(), evidence: t.text, truncated: t.truncated });
    charge(doc, "read", CLIENT.pageMicros, step, true, `${id}${t.truncated ? " (truncated)" : ""}`);
  } else {
    // A read that returns nothing is not billed: the same rule as a failed call anywhere else.
    charge(doc, "read", 0, step, false, page.error.slice(0, 160));
  }
  doc.inflight = null;
  await deps.checkpoint(doc);
  return false;
}

async function finish(doc: TaskDocument, deps: Deps, forced?: "cancelled"): Promise<true> {
  if (forced === "cancelled") {
    doc.status = "cancelled";
    doc.missing.push("cancelled_by_caller");
    return true;
  }
  if (doc.sources.length === 0) {
    doc.status = "failed";
    doc.error_code = "no_sources_read";
    return true;
  }
  if (doc.inflight) recoverUncertain(doc);

  const hasRoom = remaining(doc) >= SYNTHESIS_RESERVE_MICROS;
  if (!hasRoom) {
    doc.limit_hit = doc.limit_hit ?? "cost";
    doc.missing.push("synthesis_not_run");
    doc.status = "partial";
    doc.error_code = "limit_reached";
    return true;
  }

  doc.inflight = { op: "synthesis", micros: CLIENT.synthesisMicros, detail: "final answer" };
  await deps.checkpoint(doc);
  const raw = await deps.synthesize(doc);
  charge(doc, "synthesis", raw ? CLIENT.synthesisMicros : 0, doc.steps, raw !== null, raw ? "answer" : "no valid answer");
  doc.inflight = null;

  if (!raw) {
    doc.missing.push("synthesis_invalid");
    doc.status = "partial";
    doc.error_code = "insufficient_evidence";
    return true;
  }

  const verified = verifyResult(raw, doc.sources);
  doc.dropped_findings = verified.dropped;
  doc.result = verified.result;
  doc.missing = [...doc.missing, ...verified.result.missing];
  const decided = decideStatus({
    sourcesRead: doc.sources.length,
    verifiedFindings: verified.result.findings.length,
    missing: doc.missing.length,
    dropped: verified.dropped,
    limitHit: doc.limit_hit !== null,
  });
  doc.status = decided.status;
  doc.error_code = decided.code ?? null;
  return true;
}

/** The evidence the model may see for one call: bounded, labelled as untrusted, and cut in order. */
export function evidenceContext(doc: TaskDocument): string {
  let used = 0;
  const parts: string[] = [];
  for (const s of doc.sources) {
    const block = `<source id="${s.id}" url="${s.url}">\n${s.evidence}\n</source>`;
    if (used + block.length > MAX_CONTEXT_CHARS) break;
    used += block.length;
    parts.push(block);
  }
  return parts.join("\n");
}

