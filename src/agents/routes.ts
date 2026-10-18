/** HTTP for the three free agent services. Each one needs a free account key, so a service has an owner. */
import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { requestAccount } from "../billing/accounts";
import { AGENT_INFO, AGENT_NAMES, agentSchemas, type AgentName } from "./catalog";
import { cancelService, createService, getService, listServices } from "./services";

export const agentServiceRoutes = new Hono<{ Bindings: Env }>();

agentServiceRoutes.use("/agents/v1/*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
});

function isAgent(name: string): name is AgentName {
  return (AGENT_NAMES as string[]).includes(name);
}

agentServiceRoutes.get('/agents/v1', c=>c.json({
 agents:AGENT_NAMES.map(name=>({agent:name,...AGENT_INFO[name],describe:`GET /agents/v1/${name}`,create:`POST /agents/v1/${name}`})),
 services:'GET /agents/v1/services',cancel:'POST /agents/v1/services/:id/cancel',
}));
// Register the literal "services" before /:agent, so it cannot be mistaken for an agent name.
agentServiceRoutes.get('/agents/v1/services',async c=>{
 const account=await requestAccount(c.env.BILLING,c.req.raw.headers);
 if(!account||account==='invalid')return c.json({error:'api_key_required'},401);
 return c.json({services:await listServices(c.env,account.id),limit:100});
});

/** Public description of an agent: its parameters, so a client can build the request. */
agentServiceRoutes.get("/agents/v1/:agent", (c) => {
  const name = c.req.param("agent");
  if (!isAgent(name)) return c.json({ error: "unknown_agent", agents: AGENT_NAMES }, 404);
  const schema = agentSchemas[name];
  return c.json({
    agent: name,
    title: AGENT_INFO[name].title,
    summary: AGENT_INFO[name].summary,
    price: "free",
    parameters: Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, (v as { description?: string }).description ?? ""])),
    create: `POST /agents/v1/${name} with a free API key`,
  });
});

agentServiceRoutes.post("/agents/v1/:agent", async (c) => {
  const name = c.req.param("agent");
  if (!isAgent(name)) return c.json({ error: "unknown_agent", agents: AGENT_NAMES }, 404);
  const account = await requestAccount(c.env.BILLING, c.req.raw.headers);
  if (account === null) return c.json({ error: "api_key_required", message: "Send Authorization: Bearer oas_… from your free account." }, 401);
  if (account === "invalid") return c.json({ error: "invalid_api_key" }, 401);
  const body = await c.req.json().catch(() => null);
  const out = await createService(c.env, account.id, name, body);
  if (!out.ok) return c.json({ error: out.error }, out.status);
  return c.json({ service: out.service, message: "The first run is queued for the next scheduler tick; pending services may delay it." }, 202);
});

agentServiceRoutes.get("/agents/v1/services/:id", async (c) => {
  const account = await requestAccount(c.env.BILLING, c.req.raw.headers);
  if (account === null || account === "invalid") return c.json({ error: "invalid_api_key" }, 401);
  const service = await getService(c.env, account.id, c.req.param("id"));
  return service ? c.json({ service }) : c.json({ error: "not_found" }, 404);
});

async function cancel(c: Context<{ Bindings: Env }>) {
  const account = await requestAccount(c.env.BILLING, c.req.raw.headers);
  if (account === null || account === "invalid") return c.json({ error: "invalid_api_key" }, 401);
  const done = await cancelService(c.env, account.id, c.req.param("id") ?? "");
  return done ? c.json({ status: "cancelled", message: "Future runs are cancelled. The latest report is retained. A read already in progress may finish." }) : c.json({ error: "not_found" }, 404);
}

agentServiceRoutes.post("/agents/v1/services/:id/cancel", cancel);
