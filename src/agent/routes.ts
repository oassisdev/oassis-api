/**
 * The HTTP door for agent tasks. Only transport lives here: the key, the headers and the status
 * codes. What a task is, what it costs and what it may do is decided in service.ts, which the
 * MCP tools call as well.
 */

import { Hono } from "hono";
import { accountForKey } from "../billing/accounts";
import type { Env } from "../types";
import { cancelTask, getTask, startTask } from "./service";

export const agentRoutes = new Hono<{ Bindings: Env }>();

const bearer = (header: string | undefined): string => (header ?? "").replace(/^Bearer\s+/i, "").trim();

async function requireAccount(c: { req: { header(n: string): string | undefined }; env: Env; json: (b: unknown, s: number) => Response }): Promise<{ id: string } | Response> {
  const key = bearer(c.req.header("authorization"));
  if (!key) {
    return c.json(
      {
        success: false,
        error: "unauthorized",
        message: "Agent tasks need an API key with a balance: send `Authorization: Bearer oas_…`.",
      },
      401,
    );
  }
  const account = await accountForKey(c.env.BILLING, key);
  if (!account) return c.json({ success: false, error: "unauthorized", message: "Invalid or revoked key." }, 401);
  return { id: account.id };
}

agentRoutes.post("/agent/v1/tasks", async (c) => {
  const who = await requireAccount(c);
  if (who instanceof Response) return who;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "invalid_request", message: "The body must be JSON." }, 400);
  }

  const result = await startTask(c.env, {
    account: who.id,
    body,
    idempotencyKey: c.req.header("idempotency-key") ?? null,
    baseUrl: c.env.BASE_URL,
  });
  if (!result.ok) {
    const e = result.error;
    return c.json({ success: false, error: e.error, message: e.message, ...(e.details ? { details: e.details } : {}) }, e.status as 400);
  }
  c.header("location", result.location);
  return c.json(
    { task_id: result.taskId, status: result.status, location: result.location, replayed: !result.created },
    202,
  );
});

agentRoutes.get("/agent/v1/tasks/:id", async (c) => {
  const who = await requireAccount(c);
  if (who instanceof Response) return who;
  const out = await getTask(c.env, who.id, c.req.param("id"));
  if ("error" in out) return c.json({ success: false, error: out.error, message: out.message }, out.status as 404);
  return c.json(out.body, 200);
});

agentRoutes.post("/agent/v1/tasks/:id/cancel", async (c) => {
  const who = await requireAccount(c);
  if (who instanceof Response) return who;
  const out = await cancelTask(c.env, who.id, c.req.param("id"));
  if ("error" in out) return c.json({ success: false, error: out.error, message: out.message }, out.status as 404);
  return c.json(out.body, out.status as 202);
});
