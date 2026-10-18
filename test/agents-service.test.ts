import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import type { Env } from "../src/types";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

// Page reads are the only network part; the rest of the run is the real code.
const pages = new Map<string, string>();
vi.mock("../src/agents/checks", async (orig) => {
  const real = await orig<typeof import("../src/agents/checks")>();
  return {
    ...real,
    readTarget: async (_env: unknown, url: string) => {
      const markdown = pages.get(url);
      return markdown === undefined ? { error: "The page could not be read." } : { markdown, html: "" };
    },
  };
});

const { createService, getService, cancelService, runDueAgents } = await import("../src/agents/services");

let sqlite: InstanceType<typeof DatabaseSync>;
let env: Env;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new NodeURL("../migrations/0009_agents.sql", import.meta.url), "utf8"));
  pages.clear();
  const prepare = (sql: string) => {
    const make = (args: unknown[]) => ({
      bind: (...values: unknown[]) => make(values),
      async all() { return { results: sqlite.prepare(sql).all(...args) }; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    });
    return make([]);
  };
  env = { BILLING: { prepare } } as unknown as Env;
});

describe("price watch, end to end", () => {
  it("reads the first price, then reports a drop above the threshold", async () => {
    const url = "https://shop.example.com/kettle";
    pages.set(url, "Kettle\n$40.00\nIn stock");
    const created = await createService(env, "acc", "price-watch", { urls: [url], frequency: "daily", alert_drop_percent: 5 }, 1_000);
    expect(created.ok).toBe(true);
    const id = (created as { service: { id: string } }).service.id;

    expect(await runDueAgents(env, 1_000)).toBe(1);
    const first = (await getService(env, "acc", id))!.last_report as { targets: { change: string }[] };
    expect(first.targets[0]!.change).toBe("first_read");

    pages.set(url, "Kettle\n$30.00\nIn stock");
    expect(await runDueAgents(env, 1_000 + 86_400_000)).toBe(1);
    const second = (await getService(env, "acc", id))!.last_report as {
      summary: { alerts: number };
      targets: { change: string; previous_price: { amount: number }; price: { amount: number } }[];
    };
    expect(second.targets[0]!.change).toBe("price_changed");
    expect(second.targets[0]!.previous_price.amount).toBe(40);
    expect(second.targets[0]!.price.amount).toBe(30);
    expect(second.summary.alerts).toBe(1);
  });

  it("does not run again before the next interval", async () => {
    pages.set("https://shop.example.com/a", "A $5.00");
    await createService(env, "acc", "price-watch", { urls: ["https://shop.example.com/a"] }, 1_000);
    expect(await runDueAgents(env, 1_000)).toBe(1);
    expect(await runDueAgents(env, 1_000 + 3_600_000)).toBe(0);
  });
});

describe("web watch and competitor monitor", () => {
  it("keeps a change out of a keyword watch when no changed line names a keyword", async () => {
    const url = "https://news.example.com/terms";
    pages.set(url, "Terms\nCookie banner v1");
    const created = await createService(env, "acc", "web-watch", { urls: [url], keywords: ["pricing"] }, 1_000);
    const id = (created as { service: { id: string } }).service.id;
    await runDueAgents(env, 1_000);
    pages.set(url, "Terms\nCookie banner v2");
    await runDueAgents(env, 1_000 + 86_400_000);
    const report = (await getService(env, "acc", id))!.last_report as { targets: { change: string }[] };
    expect(report.targets[0]!.change).toBe("unchanged");
  });

  it("reads each competitor section and reports the ones that changed", async () => {
    pages.set("https://rival.example.com/pricing", "Pro $99");
    pages.set("https://rival.example.com/blog", "Post one");
    const created = await createService(env, "acc", "competitor-monitor", { domain: "https://rival.example.com", sections: ["/pricing", "/blog"] }, 1_000);
    const id = (created as { service: { id: string } }).service.id;
    await runDueAgents(env, 1_000);
    pages.set("https://rival.example.com/blog", "Post one\nPost two");
    await runDueAgents(env, 1_000 + 7 * 86_400_000);
    const report = (await getService(env, "acc", id))!.last_report as { summary: { changed: number }; targets: { url: string; change: string }[] };
    expect(report.summary.changed).toBe(1);
    expect(report.targets.find((t) => t.url.endsWith("/blog"))!.change).toBe("changed");
  });
});

describe("creation and lifecycle", () => {
  it("refuses a private address", async () => {
    const out = await createService(env, "acc", "price-watch", { urls: ["http://127.0.0.1/admin"] });
    expect(out.ok).toBe(false);
  });

  it("caps active services per account", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await createService(env, "acc", "web-watch", { urls: [`https://site${i}.example.com/`] })).ok).toBe(true);
    }
    const eleventh = await createService(env, "acc", "web-watch", { urls: ["https://site10.example.com/"] });
    expect(eleventh).toMatchObject({ ok: false, status: 409 });
  });

  it("stops running after cancellation, and only for its owner", async () => {
    pages.set("https://shop.example.com/x", "X $1.00");
    const created = await createService(env, "acc", "price-watch", { urls: ["https://shop.example.com/x"] }, 1_000);
    const id = (created as { service: { id: string } }).service.id;
    expect(await cancelService(env, "someone-else", id)).toBe(false);
    expect(await cancelService(env, "acc", id)).toBe(true);
    expect(await runDueAgents(env, 1_000)).toBe(0);
  });
});

it('a cancellation between scheduler selection and claim prevents the run',async()=>{
 const created=await createService(env,'acc','web-watch',{urls:['https://site.example.com']},1000);
 const id=(created as {service:{id:string}}).service.id;
 const original=env.BILLING.prepare.bind(env.BILLING);
 vi.spyOn(env.BILLING,'prepare').mockImplementation((query:string)=>{
  const statement=original(query);
  if(!query.startsWith('UPDATE agent_services SET next_run_at='))return statement;
  return {...statement,bind:(...args:unknown[])=>{
   const bound=statement.bind(...args);
   return {...bound,run:async()=>{await cancelService(env,'acc',id);return bound.run();}};
  }} as unknown as D1PreparedStatement;
 });
 expect(await runDueAgents(env,1000)).toBe(0);
 expect(await getService(env,'acc',id)).toMatchObject({status:'cancelled',last_report:null,next_run_at:null});
});
