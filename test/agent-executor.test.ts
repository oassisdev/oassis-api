import { describe, expect, it } from "vitest";
import { CLIENT, searchClientMicros } from "../src/agent/rates";
import { runStep, searchFailure, type Deps, type Plan, type SearchOutcome, type TaskDocument } from "../src/agent/executor";
import type { TaskResult } from "../src/agent/contract";

function doc(over: Partial<TaskDocument> = {}): TaskDocument {
  return {
    task: "Compare three hosting providers for agents",
    mode: "research",
    urls: [],
    limits: { max_cost_micros: 100_000, max_duration_ms: 180_000, max_steps: 10 },
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
    ...over,
  };
}

/** A scripted world: the plans come in order, search and read answer from fixed tables. */
function world(opts: {
  plans: (Plan | null)[];
  exaPaid?: number;
  searchFails?: "certain" | "uncertain";
  pageOk?: boolean;
  answer?: TaskResult | null;
  clock?: () => number;
}) {
  const plans = [...opts.plans];
  const deps: Deps = {
    now: opts.clock ?? (() => 1_000),
    checkpoint: async () => {},
    plan: async () => (plans.length ? plans.shift()! : { action: "finish", reason: "done" }),
    search: async (_q, maxExa): Promise<SearchOutcome> => {
      if (opts.searchFails === "certain") return { ok: false, error: "nothing was paid", certain: true, paidMicros: 0 };
      if (opts.searchFails === "uncertain") return { ok: false, error: "Exa answered HTTP 500", certain: false, paidMicros: maxExa };
      return {
        ok: true,
        results: [{ title: "Provider A", url: "https://a.example/pricing", snippet: "x" }, { title: "Provider B", url: "https://b.example/pricing" }],
        paidMicros: opts.exaPaid ?? 7_000,
      };
    },
    read: async (url) =>
      opts.pageOk === false ? { ok: false, error: "page refused" } : { ok: true, markdown: `Pricing for ${url}. Plan costs 10 USD.` },
    synthesize: async () => opts.answer === undefined ? { summary: "Summary", findings: [{ claim: "A costs 10 USD", source_ids: ["s1"] }], missing: [] } : opts.answer,
  };
  return { deps };
}

async function run(d: TaskDocument, deps: Deps, max = 20) {
  let finished = false;
  for (let i = 0; i < max && !finished; i++) finished = await runStep(d, deps);
  return d;
}

describe("a research task", () => {
  it("plans a search, reads a candidate, and completes with verified evidence", async () => {
    const { deps } = world({
      plans: [
        { action: "search", query: "hosting for agents pricing", reason: "start" },
        { action: "read", url: "https://a.example/pricing", reason: "best candidate" },
        { action: "finish", reason: "enough" },
      ],
    });
    const d = await run(doc(), deps);
    expect(d.status).toBe("completed");
    expect(d.sources.map((s) => s.url)).toEqual(["https://a.example/pricing"]);
    expect(d.result?.findings[0]?.source_ids).toEqual(["s1"]);
    // Three planning calls, one search (paid to Exa and charged double), one page, one answer.
    const expected = 3 * CLIENT.planMicros + searchClientMicros(7_000) + CLIENT.pageMicros + CLIENT.synthesisMicros;
    expect(d.spent_micros).toBe(expected);
  });

  it("never reads a url the caller did not provide or the search did not return", async () => {
    const { deps } = world({
      plans: [
        { action: "read", url: "https://evil.example/", reason: "invented" },
        { action: "finish", reason: "done" },
      ],
    });
    const d = await run(doc(), deps);
    expect(d.sources).toEqual([]);
    expect(d.status).toBe("failed");
    expect(d.read_urls).toEqual([]);
  });

  it("reads a url the caller provided, even without a search", async () => {
    const { deps } = world({ plans: [{ action: "read", url: "https://a.example/x", reason: "given" }, { action: "finish", reason: "done" }] });
    const d = await run(doc({ urls: ["https://a.example/x"] }), deps);
    expect(d.sources).toHaveLength(1);
  });

  it("refuses a private url even when the planner names it", async () => {
    const { deps } = world({ plans: [{ action: "read", url: "http://10.0.0.1/", reason: "internal" }, { action: "finish", reason: "x" }] });
    const d = await run(doc({ urls: ["http://10.0.0.1/"] }), deps);
    expect(d.sources).toEqual([]);
  });

  it("is partial when the answer cites a source that was never read", async () => {
    const { deps } = world({
      plans: [{ action: "read", url: "https://a.example/pricing", reason: "x" }, { action: "finish", reason: "y" }],
      answer: { summary: "s", findings: [{ claim: "made up", source_ids: ["s9"] }], missing: [] },
    });
    const d = await run(doc({ candidates: [{ url: "https://a.example/pricing", title: "A" }] }), deps);
    expect(d.status).toBe("partial");
    expect(d.dropped_findings).toBe(1);
    expect(d.result?.findings).toEqual([]);
  });

  it("is partial when the model reports missing requirements, even if it says it is done", async () => {
    const { deps } = world({
      plans: [{ action: "read", url: "https://a.example/pricing", reason: "x" }, { action: "finish", reason: "done" }],
      answer: { summary: "s", findings: [{ claim: "A costs 10 USD", source_ids: ["s1"] }], missing: ["support hours"] },
    });
    const d = await run(doc({ candidates: [{ url: "https://a.example/pricing", title: "A" }] }), deps);
    expect(d.status).toBe("partial");
    expect(d.missing).toContain("support hours");
  });

  it("is failed when no page was read at all", async () => {
    const { deps } = world({ plans: [{ action: "search", query: "q", reason: "x" }, { action: "finish", reason: "y" }] });
    const d = await run(doc(), deps);
    expect(d.status).toBe("failed");
    expect(d.error_code).toBe("no_sources_read");
  });
});

describe("paying the search provider", () => {
  it("charges nothing when the provider refused before anything was paid", async () => {
    const { deps } = world({ plans: [{ action: "search", query: "q", reason: "x" }, { action: "finish", reason: "y" }], searchFails: "certain" });
    const d = await run(doc(), deps);
    expect(d.operations.find((o) => o.op === "search")?.micros).toBe(0);
  });

  it("charges the most it could have owed when the outcome is uncertain", async () => {
    const { deps } = world({ plans: [{ action: "search", query: "q", reason: "x" }, { action: "finish", reason: "y" }], searchFails: "uncertain" });
    const d = await run(doc({ limits: { max_cost_micros: 50_000, max_duration_ms: 180_000, max_steps: 10 } }), deps);
    const search = d.operations.find((o) => o.op === "search");
    expect(search?.micros).toBeGreaterThan(0);
    expect(search?.micros).toBeLessThanOrEqual(50_000);
  });
});

describe("limits", () => {
  it("never spends more than the budget authorised", async () => {
    const { deps } = world({
      plans: Array.from({ length: 30 }, (_, i) => ({ action: "search" as const, query: `q${i}`, reason: "more" })),
    });
    const d = await run(doc({ limits: { max_cost_micros: 60_000, max_duration_ms: 180_000, max_steps: 30 } }), deps);
    expect(d.spent_micros).toBeLessThanOrEqual(60_000);
    expect(["partial", "failed"]).toContain(d.status);
  });

  it("stops at the step limit and says so", async () => {
    const { deps } = world({ plans: Array.from({ length: 10 }, () => ({ action: "search" as const, query: "q", reason: "x" })) });
    const d = await run(doc({ limits: { max_cost_micros: 1_000_000, max_duration_ms: 180_000, max_steps: 2 } }), deps);
    expect(d.limit_hit).toBe("steps");
    expect(d.steps).toBe(2);
  });

  it("stops when the duration runs out", async () => {
    let t = 0;
    const { deps } = world({ plans: [{ action: "search", query: "q", reason: "x" }], clock: () => t });
    const d = doc({ limits: { max_cost_micros: 1_000_000, max_duration_ms: 1_000, max_steps: 10 } });
    t = 0;
    await runStep(d, deps);
    t = 5_000;
    await runStep(d, deps);
    expect(d.limit_hit).toBe("duration");
  });
});

describe("cancellation", () => {
  it("stops before any paid operation and charges nothing", async () => {
    const { deps } = world({ plans: [{ action: "search", query: "q", reason: "x" }] });
    const d = await run(doc({ cancel_requested: true }), deps);
    expect(d.status).toBe("cancelled");
    expect(d.spent_micros).toBe(0);
  });
});

describe("restarts", () => {
  it("charges an operation announced before a restart and never repeats it", async () => {
    const { deps } = world({ plans: [{ action: "finish", reason: "x" }] });
    const d = doc({
      steps: 1,
      sources: [{ id: "s1", url: "https://a.example/pricing", retrieved_at: "t", evidence: "e", truncated: false }],
      inflight: { op: "search", micros: 14_000, detail: "q" },
    });
    await run(d, deps);
    expect(d.operations.some((o) => o.op === "search" && o.micros === 14_000 && !o.ok)).toBe(true);
    expect(d.spent_micros).toBeGreaterThanOrEqual(14_000);
    expect(d.status).toBe("partial");
    expect(d.missing.some((m) => m.endsWith("outcome_unknown"))).toBe(true);
  });

  it("a finished task is final: a later step changes nothing", async () => {
    const { deps } = world({ plans: [] });
    const d = doc({ status: "completed", spent_micros: 5 });
    expect(await runStep(d, deps)).toBe(true);
    expect(d.spent_micros).toBe(5);
  });
});

describe("search failures are classified before anything is charged", () => {
  it("owes nothing when the deployment cannot pay, or the challenge was refused", () => {
    expect(searchFailure("Search is not configured on this deployment: there is no X402_WALLET_KEY to pay with.", 7_000)).toEqual({ certain: true, paidMicros: 0 });
    expect(searchFailure("the search provider's price is above the amount authorised, so nothing was paid", 7_000)).toEqual({ certain: true, paidMicros: 0 });
  });
  it("owes the most it could have cost when the provider failed after a payment may have happened", () => {
    expect(searchFailure("Exa answered HTTP 500.", 7_000)).toEqual({ certain: false, paidMicros: 7_000 });
  });
});

