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

import { Hono, type Context } from "hono";
import { z } from "zod";
import { accountForKey } from "./billing/accounts";
import { badRequest } from "./http";
import type { Env } from "./types";

/** A day's worth of reports per account. Free to send is not free to store. */
const MAX_PER_DAY = 50;

export const feedback = new Hono<{ Bindings: Env }>();

const bothPaths = (suffix: string) => [`/web/v1/${suffix}`, `/v1/${suffix}`];

export const feedbackRequest = z
  .object({
    /** The only field worth aggregating: did the answer do the job or not. */
    verdict: z.enum(["good", "bad"]),
    /** Which endpoint it is about, as you called it. */
    route: z.string().min(1).max(120).optional(),
    /** The jobId or sessionId it happened on, so it can be looked up. */
    reference: z.string().min(1).max(200).optional(),
    /** The page that came out wrong, which is usually the fastest way to reproduce it. */
    url: z.string().url().optional(),
    comment: z.string().min(1).max(2_000).optional(),
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

async function caller(c: Context<{ Bindings: Env }>): Promise<string | Response> {
  const key = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!key) {
    return c.json(
      {
        success: false,
        error: "unauthorized",
        message: "Send your API key in `Authorization: Bearer oas_…` so we can follow up on what you report.",
      },
      401,
    );
  }
  const account = await accountForKey(c.env.BILLING, key);
  if (!account) {
    return c.json({ success: false, error: "unauthorized", message: "Invalid or revoked key." }, 401);
  }
  return account.id;
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
          `Up to ${MAX_PER_DAY} reports a day per account.`,
        ],
      },
      200,
      { "cache-control": "public, max-age=3600" },
    ),
  );

  feedback.post(route, async (c) => {
    const who = await caller(c);
    if (who instanceof Response) return who;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: "bad_request", message: "The body must be JSON." }, 400);
    }

    const parsed = feedbackRequest.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error);

    const today = await c.env.BILLING.prepare(
      `SELECT COUNT(*) AS n FROM feedback WHERE account = ? AND at >= ?`,
    )
      .bind(who, Date.now() - 86_400_000)
      .first<{ n: number }>();
    if ((today?.n ?? 0) >= MAX_PER_DAY) {
      return c.json(
        {
          success: false,
          error: "too_many_reports",
          message: `Up to ${MAX_PER_DAY} reports a day per account. Send the rest tomorrow, or put several findings in one comment.`,
        },
        429,
      );
    }

    const { verdict, route: about, reference, url, comment } = parsed.data;
    await c.env.BILLING.prepare(
      `INSERT INTO feedback (account, at, verdict, route, reference, url, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(who, Date.now(), verdict, about ?? null, reference ?? null, url ?? null, comment ?? null)
      .run();

    return c.json({
      success: true,
      message:
        verdict === "bad"
          ? "Logged. If you left a url or a reference, it is enough to reproduce it."
          : "Logged, and thank you: knowing what works is as useful as knowing what does not.",
    });
  });
}
