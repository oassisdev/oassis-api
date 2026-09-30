import { describe, expect, it } from "vitest";
import { feedback, feedbackRequest } from "../src/feedback";

/** Fake D1: knows one key, counts what has been written and how many reports exist today. */
function fakeEnv(opts: { known?: boolean; today?: number } = {}) {
  const known = opts.known ?? true;
  const writes: unknown[][] = [];
  const BILLING = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          if (sql.includes("INSERT INTO feedback")) writes.push(args);
          return {
            async run() {
              return { meta: { changes: 1 } };
            },
            async first() {
              if (sql.includes("FROM api_keys")) {
                return known ? { id: "acct-1", balance: 1_000, sessions: 3 } : null;
              }
              if (sql.includes("COUNT(*) AS n FROM feedback")) return { n: opts.today ?? 0 };
              return null;
            },
          };
        },
      };
    },
  };
  return { env: { BILLING } as never, writes };
}

const send = (body: unknown, key: string | null, env: never, path = "/v1/feedback") =>
  feedback.request(
    path,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    },
    env,
  );

describe("what a report needs", () => {
  it("a verdict, and nothing else for a good one", () => {
    expect(feedbackRequest.safeParse({ verdict: "good" }).success).toBe(true);
    expect(feedbackRequest.safeParse({}).success).toBe(false);
    expect(feedbackRequest.safeParse({ verdict: "meh" }).success).toBe(false);
  });

  it("a bad verdict needs something to go on", () => {
    const bare = feedbackRequest.safeParse({ verdict: "bad" });
    expect(bare.success).toBe(false);
    if (!bare.success) expect(bare.error.issues[0]?.message).toMatch(/nothing we can look at/);

    expect(feedbackRequest.safeParse({ verdict: "bad", comment: "empty markdown" }).success).toBe(true);
    expect(feedbackRequest.safeParse({ verdict: "bad", url: "https://a.com" }).success).toBe(true);
    expect(feedbackRequest.safeParse({ verdict: "bad", reference: "job-1" }).success).toBe(true);
  });

  it("rejects an unknown field and an overlong comment", () => {
    expect(feedbackRequest.safeParse({ verdict: "good", stars: 5 }).success).toBe(false);
    expect(feedbackRequest.safeParse({ verdict: "good", comment: "x".repeat(2_001) }).success).toBe(false);
  });
});

describe("who can report", () => {
  it("a key is required, and the message says why", async () => {
    const { env } = fakeEnv();
    const r = await send({ verdict: "good" }, null, env);
    expect(r.status).toBe(401);
    expect(((await r.json()) as any).message).toMatch(/follow up/);
  });

  it("an unknown key is rejected", async () => {
    const { env } = fakeEnv({ known: false });
    expect((await send({ verdict: "good" }, "oas_nope", env)).status).toBe(401);
  });
});

describe("storing it", () => {
  it("writes the report with its account and verdict", async () => {
    const { env, writes } = fakeEnv();
    const r = await send(
      { verdict: "bad", url: "https://a.com", comment: "markdown came back empty", route: "/v1/scrape" },
      "oas_k",
      env,
    );
    expect(r.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe("acct-1");
    expect(writes[0]?.[2]).toBe("bad");
    expect(writes[0]?.[3]).toBe("/v1/scrape");
    expect(writes[0]?.[5]).toBe("https://a.com");
  });

  it("works on both path shapes", async () => {
    const { env } = fakeEnv();
    expect((await send({ verdict: "good" }, "oas_k", env, "/web/v1/feedback")).status).toBe(200);
  });

  it("stops at fifty a day, and says what to do instead", async () => {
    const { env, writes } = fakeEnv({ today: 50 });
    const r = await send({ verdict: "good" }, "oas_k", env);
    expect(r.status).toBe(429);
    expect(((await r.json()) as any).message).toMatch(/one comment/);
    expect(writes).toEqual([]);
  });

  it("a GET explains the endpoint instead of failing", async () => {
    const { env } = fakeEnv();
    const r = await feedback.request("/v1/feedback", {}, env);
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).request.verdict).toMatch(/good/);
  });
});
