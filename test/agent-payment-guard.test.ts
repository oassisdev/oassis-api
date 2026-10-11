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

  it("rejects a plan with an unknown action, and retries once", async () => {
    const ai = fakeAi([{ response: { action: "purchase", reason: "x" } }, { response: { action: "finish", reason: "ok" } }]);
    expect(await planNextStep(ai, doc)).toEqual({ action: "finish", reason: "ok" });
    expect(ai.calls).toBe(2);
  });

  it("returns null when the model never gives a valid reply", async () => {
    expect(await planNextStep(fakeAi([]), doc)).toBeNull();
  });

  it("rejects a synthesis that does not match the contract", async () => {
    const bad = { response: { summary: "s", findings: [{ claim: "x" }], missing: [] } };
    expect(await synthesize(fakeAi([bad, bad]), { ...doc, sources: [] } as unknown as TaskDocument)).toBeNull();
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

