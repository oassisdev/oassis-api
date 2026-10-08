/**
 * What went wrong, told by the client.
 *
 * An agent that gets bad markdown or a control map missing a button has no other way
 * to say so, and we have no other way to find out: nothing in the logs distinguishes a
 * page we read badly from a page that is simply like that.
 *
 * It is free. Charging for a complaint would mean paying to be told we are broken, and
 * the report is worth more to us than the fraction of a cent.
 */

import { Hono } from "hono";
import { z } from "zod";
import { accountForKey } from "./billing/accounts";
import { badRequest } from "./http";
import type { Env } from "./types";

/** A day's worth of reports per account. Free to send is not free to store. */
const MAX_PER_DAY = 50;

/** Reports with no key, across every anonymous caller, per day. */
const MAX_ANONYMOUS_PER_DAY = 200;

export const feedback = new Hono<{ Bindings: Env }>();

const bothPaths = (suffix: string) => [`/web/v1/${suffix}`, `/v1/${suffix}`];

export const feedbackRequest = z
  .object({
    verdict: z.enum(["good", "bad"]).describe("Did the answer do the job or not."),
    route: z.string().min(1).max(120).optional().describe("Which tool or endpoint it is about, as you called it."),
    reference: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("The jobId or sessionId it happened on, so it can be looked up."),
    url: z.string().url().optional().describe("The page that came out wrong: usually the fastest way to reproduce it."),
    comment: z.string().min(1).max(2_000).optional().describe("What you expected and what you got."),
  })
  .strict()
  .superRefine((v, ctx) => {
    // A bare "bad" with nothing attached cannot be acted on, and saying so is more
    // useful than storing it.
    if (v.verdict === "bad" && !v.comment && !v.url && !v.reference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A `bad` verdict needs something to go on: `comment`, `url` or `reference`. Otherwise there is nothing we can look at.",
        path: ["comment"],
      });
    }
  });

/** The account behind the key, null when there is no key, or "invalid" when the key is unknown. */
export async function reporter(env: Env, key: string): Promise<string | null | "invalid"> {
  if (!key) return null;
  const account = await accountForKey(env.BILLING, key);
  return account ? account.id : "invalid";
}

export async function storeFeedback(
  env: Env,
  who: string | null,
  data: z.infer<typeof feedbackRequest>,
  fallbackRoute?: string,
): Promise<"stored" | "too_many"> {
  const since = Date.now() - 86_400_000;
  const today = who
    ? await env.BILLING.prepare(`SELECT COUNT(*) AS n FROM feedback WHERE account = ? AND at >= ?`)
        .bind(who, since)
        .first<{ n: number }>()
    : await env.BILLING.prepare(`SELECT COUNT(*) AS n FROM feedback WHERE account IS NULL AND at >= ?`)
        .bind(since)
        .first<{ n: number }>();
  if ((today?.n ?? 0) >= (who ? MAX_PER_DAY : MAX_ANONYMOUS_PER_DAY)) return "too_many";

  await env.BILLING.prepare(
    `INSERT INTO feedback (account, at, verdict, route, reference, url, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      who,
      Date.now(),
      data.verdict,
      data.route ?? fallbackRoute ?? null,
      data.reference ?? null,
      data.url ?? null,
      data.comment ?? null,
    )
    .run();
  return "stored";
}

for (const route of bothPaths("feedback")) {
  feedback.get(route, (c) =>
    c.json(
      {
      endpoint: `POST ${c.req.path}`,
      description:
        "Tell us an answer was good or bad. Free, and the only channel to report a bad result: nothing in our logs distinguishes a page we read badly from a page that is simply like that.",
      request: {
        verdict: '"good" or "bad" — required',
        route: "string — which endpoint it is about",
        reference: "string — the jobId or sessionId it happened on",
        url: "string — the page that came out wrong, the fastest way to reproduce it",
        comment: "string — what you expected and what you got (up to 2000 characters)",
      },
        notes: [
          "A `bad` verdict needs a `comment`, a `url` or a `reference`: without one there is nothing to look at.",
          `No key needed. With a key, up to ${MAX_PER_DAY} reports a day per account; without one, ${MAX_ANONYMOUS_PER_DAY} a day across all anonymous callers.`,
        ],
      },
      200,
      { "cache-control": "public, max-age=3600" },
    ),
  );

  feedback.post(route, async (c) => {
    const who = await reporter(c.env, (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim());
    if (who === "invalid") return c.json({ success: false, error: "unauthorized", message: "Invalid or revoked key." }, 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "bad_request", message: "The body must be JSON." }, 400);
    }

    const parsed = feedbackRequest.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error);

    if ((await storeFeedback(c.env, who, parsed.data)) === "too_many") {
      return c.json(
        {
          success: false,
          error: "too_many_reports",
          message: who
            ? `Up to ${MAX_PER_DAY} reports a day per account. Send the rest tomorrow, or put several findings in one comment.`
            : "Today's anonymous reports are used up across all callers. Send them tomorrow, or with an API key.",
        },
        429,
      );
    }

    return c.json({
      success: true,
      message:
        parsed.data.verdict === "bad"
          ? "Logged. If you left a url or a reference, it is enough to reproduce it."
          : "Logged, and thank you: knowing what works is as useful as knowing what does not.",
    });
  });
}
