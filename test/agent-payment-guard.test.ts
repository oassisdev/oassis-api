import { describe, expect, it } from "vitest";
import { assertChallengeWithin } from "../src/search/exa";
import { normalizePlan, planNextStep, synthesize } from "../src/agent/model";
import type { TaskDocument } from "../src/agent/executor";

const BASE = "eip155:8453";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const guard = { maxMicros: 10_000, network: BASE, asset: USDC };

function challenge(opts: { amount?: string; network?: string; asset?: string } = {}, header = true): Response {
  const body = { accepts: [{ amount: opts.amount ?? "7000", network: opts.network ?? BASE, asset: opts.asset ?? USDC }] };
  const headers = new Headers();
  if (header) headers.set("payment-required", btoa(JSON.stringify(body)));
  return new Response(null, { status: 402, headers });
}

describe("the search payment guard", () => {
  it("allows a challenge within the authorised amount, on the expected network and asset", () => {
    expect(() => assertChallengeWithin(challenge(), guard)).not.toThrow();
  });
  it("refuses a price that rose above the authorised amount, before anything is signed", () => {
    expect(() => assertChallengeWithin(challenge({ amount: "10001" }), guard)).toThrow(/nothing was paid/);
  });
  it("refuses another network or another asset", () => {
    expect(() => assertChallengeWithin(challenge({ network: "eip155:1" }), guard)).toThrow(/nothing was paid/);
    expect(() => assertChallengeWithin(challenge({ asset: "0x0000000000000000000000000000000000000001" }), guard)).toThrow(/nothing was paid/);
  });
  it("refuses a price that is not a whole number, rather than letting NaN pass the limit", () => {
    expect(() => assertChallengeWithin(challenge({ amount: "not-a-number" }), guard)).toThrow(/nothing was paid/);
    expect(() => assertChallengeWithin(challenge({ amount: "1e9" }), guard)).toThrow(/nothing was paid/);
  });
  it("reports the quoted price before refusing it", () => {
    let quoted = 0;
    expect(() => assertChallengeWithin(challenge({ amount: "10001" }), { ...guard, onQuote: (m) => (quoted = m) })).toThrow();
    expect(quoted).toBe(10_001);
  });
  it("refuses a challenge it cannot read: failing closed", () => {
    expect(() => assertChallengeWithin(challenge({}, false), guard)).toThrow(/nothing was paid/);
  });
});

function fakeAi(replies: unknown[]) {
  const queue = [...replies];
  return {
    calls: 0,
    async run() {
      this.calls += 1;
      return queue.length ? queue.shift() : { response: "not json" };
    },
  };
}

const doc = {
  task: "Compare providers",
  urls: [],
  candidates: [],
  read_urls: [],
  sources: [],
  steps: 0,
  limits: { max_steps: 10 },
} as unknown as TaskDocument;

describe("model replies", () => {
  it("accepts a valid plan given as an object or as a JSON string", async () => {
    expect(await planNextStep(fakeAi([{ response: { action: "search", query: "provider pricing", reason: "start" } }]), doc)).toEqual({
      action: "search",
      query: "provider pricing",
      reason: "start",
    });
    expect(await planNextStep(fakeAi([{ response: '{"action":"finish","reason":"done"}' }]), doc)).toEqual({ action: "finish", reason: "done" });
  });

  it("rejects a plan with an unknown action, with one attempt only", async () => {
    const ai = fakeAi([{ response: { action: "purchase", reason: "x" } }, { response: { action: "finish", reason: "ok" } }]);
    expect(await planNextStep(ai, doc)).toBeNull();
    expect(ai.calls).toBe(1);
  });

  it("returns null when the model never gives a valid reply", async () => {
    expect(await planNextStep(fakeAi([]), doc)).toBeNull();
  });

  it("rejects a synthesis that does not match the contract", async () => {
    const bad = { response: { summary: "s", findings: [{ claim: "x" }], missing: [] } };
    expect(await synthesize(fakeAi([bad, bad]), { ...doc, sources: [] } as unknown as TaskDocument)).toEqual({ refusal: "schema_mismatch" });
  });
});

describe("planner replies with extra or empty fields", () => {
  it("keeps the chosen action and drops fields it does not use", async () => {
    expect(normalizePlan({ action: "finish", reason: "done", query: null, url: "" })).toEqual({ action: "finish", reason: "done" });
    expect(await planNextStep(fakeAi([{ response: { action: "finish", reason: "done", query: null } }]), doc)).toEqual({ action: "finish", reason: "done" });
  });
  it("still refuses a read with no url", async () => {
    expect(await planNextStep(fakeAi([{ response: { action: "read", reason: "x" } }, { response: { action: "read", reason: "x" } }]), doc)).toBeNull();
  });
});


describe("research missing requirements", () => {
  it.each(["None", "nothing", "N/A", "Nada.", "no missing information"])("normalizes the exact absence marker %s", async (marker) => {
    const response = { summary: "A book costs £51.77.", findings: [{ claim: "The price is £51.77.", source_ids: ["s1"] }], missing: [marker] };
    const out = await synthesize(fakeAi([{ response }]), doc);
    expect(out).toEqual({ result: { ...response, missing: [] } });
  });
  it("preserves genuine gaps even when mixed with an absence marker", async () => {
    const response = { summary: "One price was found.", findings: [{ claim: "The price is £51.77.", source_ids: ["s1"] }], missing: ["None", "The second product's price was not found.", "Nothing is known about the requested delivery cost."] };
    const out = await synthesize(fakeAi([{ response }]), doc);
    expect(out).toEqual({ result: { ...response, missing: response.missing.slice(1) } });
  });
});
