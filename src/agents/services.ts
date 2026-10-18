/** Free agent services: create, read, cancel, and the scheduled run that keeps them current. */
import type { Env } from "../types";
import { AGENT_INFO, LIMITS, agentSchemas, type AgentName } from "./catalog";
import { checkPublicUrl } from "../agent/request";
import { compare, matchesKeywords, readTarget, type Snapshot, type Target } from "./checks";

interface ServiceRow {
  id: string;
  account: string;
  agent: AgentName;
  config: string;
  status: string;
  frequency: "daily" | "weekly";
  next_run_at: number;
  last_run_at: number | null;
  last_report: string | null;
  created_at: number;
}

export type Created = { ok: true; service: ReturnType<typeof view> } | { ok: false; status: 400 | 409; error: string };

export function view(row: ServiceRow) {
  return {
    id: row.id,
    agent: row.agent,
    status: row.status,
    frequency: row.frequency,
    config: JSON.parse(row.config),
    next_run_at: row.status === "active" ? new Date(row.next_run_at).toISOString() : null,
    last_run_at: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    last_report: row.last_report ? JSON.parse(row.last_report) : null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/** Every URL a service reads, after checking each one is public. */
function targetsOf(agent: AgentName, config: Record<string, unknown>): string[] {
  if (agent === "competitor-monitor") {
    const domain = String(config.domain);
    const sections = config.sections as string[];
    return sections.map((s) => new URL(s, domain).href);
  }
  return config.urls as string[];
}

export async function createService(env: Env, account: string, agent: AgentName, body: unknown, now = Date.now()): Promise<Created> {
  const parsed = agentSchemas[agent].safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, status: 400, error: `${issue?.path.join(".") || "body"}: ${issue?.message}` };
  }
  const config = parsed.data as Record<string, unknown>;
  for (const url of targetsOf(agent, config)) {
    const refusal = checkPublicUrl(url);
    if (refusal !== null) return { ok: false, status: 400, error: `${url} is not a public http(s) address (${refusal}).` };
  }
  const active = await env.BILLING.prepare("SELECT COUNT(*) AS n FROM agent_services WHERE account=? AND status='active'").bind(account).first<{ n: number }>();
  if ((active?.n ?? 0) >= LIMITS.activePerAccount) {
    return { ok: false, status: 409, error: `An account can have ${LIMITS.activePerAccount} active services.` };
  }
  const id = crypto.randomUUID();
  const frequency = (config.frequency as "daily" | "weekly") ?? "daily";
  await env.BILLING.prepare(
    "INSERT INTO agent_services(id,account,agent,config,status,frequency,next_run_at,created_at) VALUES(?,?,?,?,'active',?,?,?)",
  ).bind(id, account, agent, JSON.stringify(config), frequency, now, now).run();
  const row = await env.BILLING.prepare("SELECT * FROM agent_services WHERE id=?").bind(id).first<ServiceRow>();
  return { ok: true, service: view(row!) };
}

export async function getService(env: Env, account: string, id: string) {
  const row = await env.BILLING.prepare("SELECT * FROM agent_services WHERE id=? AND account=?").bind(id, account).first<ServiceRow>();
  return row ? view(row) : null;
}

export async function listServices(env: Env, account: string) {
 const rows=await env.BILLING.prepare('SELECT * FROM agent_services WHERE account=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(account).all<ServiceRow>();
 return rows.results.map(view);
}

export async function cancelService(env: Env, account: string, id: string): Promise<boolean> {
  const res = await env.BILLING.prepare("UPDATE agent_services SET status='cancelled' WHERE id=? AND account=? AND status='active'").bind(id, account).run();
  if((res.meta?.changes ?? 0) > 0)return true;
  const existing=await env.BILLING.prepare("SELECT status FROM agent_services WHERE id=? AND account=?").bind(id,account).first<{status:string}>();
  return existing?.status === "cancelled";
}

/** Runs one service now: reads its targets, compares with the last snapshot, stores the new one. */
export async function runService(env: Env, row: ServiceRow, now = Date.now()) {
  const agent = row.agent;
  const config = JSON.parse(row.config) as Record<string, unknown>;
  const targets = targetsOf(agent, config).slice(0, LIMITS.readsPerRun);

  const prior = await env.BILLING.prepare("SELECT target, hash, value FROM agent_snapshots WHERE service=?")
    .bind(row.id).all<{ target: string; hash: string; value: string }>();
  const before = new Map((prior.results ?? []).map((r) => [r.target, JSON.parse(r.value) as Snapshot]));

  const reports: Target[] = [];
  for (const url of targets) {
    const current=await env.BILLING.prepare('SELECT status FROM agent_services WHERE id=?').bind(row.id).first<{status:string}>();
    if(current?.status!=='active')break;
    const page = await readTarget(env, url);
    if ("error" in page) {
      reports.push({ url, status: "error", change: "error", error: page.error });
      continue;
    }
    const kind = agent === "price-watch" ? "price" : "text";
    const { target, snapshot } = await compare(url, page, before.get(url), kind);
    const isNew = !before.has(url);
    if (agent === "web-watch" || agent === "competitor-monitor") {
      const keywords = (config.keywords as string[] | undefined) ?? [];
      const relevant = matchesKeywords([...(target.added ?? []), ...(target.removed ?? [])], keywords);
      if (target.change === "changed" && !relevant) target.change = "unchanged";
    }
    await env.BILLING.prepare(
      "INSERT INTO agent_snapshots(service,target,taken_at,hash,value) VALUES(?,?,?,?,?) ON CONFLICT(service,target) DO UPDATE SET taken_at=excluded.taken_at, hash=excluded.hash, value=excluded.value",
    ).bind(row.id, url, now, snapshot.hash, JSON.stringify(snapshot)).run();
    if (isNew) target.change = "first_read";
    reports.push(target);
  }

  const alertDrop = Number(config.alert_drop_percent ?? 0);
  for (const t of reports) {
    if (t.change === "price_changed" && t.previous_price && t.price) {
      const drop = ((t.previous_price.amount - t.price.amount) / t.previous_price.amount) * 100;
      (t as Target & { alert?: boolean }).alert = drop >= alertDrop;
    }
  }
  const summary = {
    targets: reports.length,
    changed: reports.filter((t) => t.change === "changed" || t.change === "price_changed").length,
    alerts: reports.filter((t) => (t as Target & { alert?: boolean }).alert).length,
    errors: reports.filter((t) => t.status === "error").length,
  };
  return { agent, ran_at: new Date(now).toISOString(), summary, targets: reports };
}

/** The scheduled run: claims a few due services, runs them, and schedules the next run. */
export async function runDueAgents(env: Env, now = Date.now()): Promise<number> {
  const due = await env.BILLING.prepare(
    "SELECT * FROM agent_services WHERE status='active' AND next_run_at<=? ORDER BY next_run_at LIMIT ?",
  ).bind(now, LIMITS.runsPerTick).all<ServiceRow>();
  let ran = 0;
  for (const row of due.results ?? []) {
    const next = now + AGENT_INFO[row.agent].intervalMs[row.frequency];
    // Claim first: a row whose next run has already moved on is someone else's to run.
    const claim = await env.BILLING.prepare("UPDATE agent_services SET next_run_at=? WHERE id=? AND status='active' AND next_run_at<=?")
      .bind(next, row.id, now).run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    try {
      const report = await runService(env, row, now);
      await env.BILLING.prepare("UPDATE agent_services SET last_run_at=?, last_report=? WHERE id=? AND status='active'")
        .bind(now, JSON.stringify(report), row.id).run();
    } catch (e) {
      const report = { agent: row.agent, ran_at: new Date(now).toISOString(), error: "The run failed. It will be retried at the next interval." };
      await env.BILLING.prepare("UPDATE agent_services SET last_run_at=?, last_report=? WHERE id=? AND status='active'")
        .bind(now, JSON.stringify(report), row.id).run();
      console.error("agent run failed", row.agent, e instanceof Error ? e.message : String(e));
    }
    ran++;
  }
  return ran;
}
