import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { Hono } from "hono";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { runInNewContext } from "node:vm";
import { authPage } from "../src/site-auth-page";
import { mountSiteAuth } from "../src/site-auth";
import { mountTraceLog } from "../src/traces";
import type { Env } from "../src/types";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

describe("optional website accounts", () => {
  let sqlite: any;
  let app: Hono<{ Bindings: Env }>;
  let env: Env;
  const statements: string[] = [];
  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(readFileSync(new NodeURL("../migrations/0006_site_auth.sql", import.meta.url), "utf8"));
    statements.length = 0;
    const prepare = (sql: string) => {
      statements.push(sql);
      const make = (args: unknown[]) => ({
        bind: (...values: unknown[]) => make(values),
        async all() { return { results: sqlite.prepare(sql).all(...args), meta: { changes: 1, last_row_id: 0 } }; },
        async run() { return { meta: sqlite.prepare(sql).run(...args) }; },
      });
      return make([]);
    };
    env = { AUTH_SECRET: "test-only-random-long-secret-1234567890123456789", BILLING: {
      prepare, batch: async (batch: { all(): Promise<unknown> }[]) => Promise.all(batch.map(s => s.all())),
      exec: async (sql: string) => sqlite.exec(sql),
    } } as unknown as Env;
    app = new Hono<{ Bindings: Env }>();
    mountTraceLog(app);
    mountSiteAuth(app);
  });
  afterEach(() => { vi.restoreAllMocks(); sqlite.close(); });
  const request = (path: string, body?: unknown, extra: Record<string, string> = {}, host = "oassis.dev") => app.fetch(new Request(`https://${host}${path}`, {
    method: body ? "POST" : "GET", headers: { "cf-connecting-ip": "192.0.2.10", ...(body ? { "content-type": "application/json", origin: "https://oassis.dev" } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext);
  const credentials = { name: "Test", email: "auth-test@example.com", password: "long-test-password-123" };

  it("signs up, hashes passwords, maintains a session, and revokes logout", async () => {
    const signup = await request("/api/auth/sign-up/email", credentials);
    expect(signup.status, await signup.clone().text()).toBe(200);
    const cookie = signup.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax");
    const hash = sqlite.prepare("SELECT password FROM site_account").get().password;
    expect(hash).not.toContain(credentials.password); expect(hash).toMatch(/^[a-f0-9]+:[a-f0-9]+$/);
    const headers = { cookie: cookie.split(";")[0]! };
    const session = await request("/api/auth/get-session", undefined, headers);
    expect((await session.json() as any).user.email).toBe(credentials.email);
    const dashboard = await request("/dashboard", undefined, headers);
    expect(dashboard.status).toBe(200); expect(dashboard.headers.get("cache-control")).toBe("no-store");
    expect(await dashboard.text()).toContain("Email not verified");
    expect((await request("/api/auth/sign-out", {}, headers)).status).toBe(200);
    expect(await (await request("/api/auth/get-session", undefined, headers)).json()).toBeNull();
    expect(statements.join(" ")).not.toContain("INSERT INTO traces");
  });
  it("rejects incorrect passwords and permits a later correct login", async () => {
    await request("/api/auth/sign-up/email", credentials);
    const bad = await request("/api/auth/sign-in/email", { ...credentials, password: "incorrect-password" });
    expect(bad.status).toBe(401);
    const good = await request("/api/auth/sign-in/email", credentials);
    expect(good.status).toBe(200);
  });
  it("rejects short passwords and cross-origin signup", async () => {
    expect((await request("/api/auth/sign-up/email", { ...credentials, password: "short" })).status).toBe(400);
    expect((await request("/api/auth/sign-up/email", credentials, { origin: "https://evil.example" })).status).toBe(403);
    expect(sqlite.prepare("SELECT count(*) n FROM site_user").get().n).toBe(0);
  });
  it("shows both providers honestly, protects dashboard and avoids API-host accounts", async () => {
    const page = await request("/signup");
    expect(page.headers.get("cache-control")).toBe("no-store");
    const html = await page.text(); expect(html).toContain("Create Account");
    expect(html).toContain('data-provider="google" aria-disabled="true"');
    expect(html).toContain('data-provider="github" aria-disabled="true"');
    expect((await request("/dashboard")).headers.get("location")).toBe("/login");
    expect((await request("/api/auth/sign-up/email", credentials, {}, "api.oassis.dev")).status).toBe(404);
    expect((await request("/api/auth/sign-in/social", { provider: "google", callbackURL: "https://oassis.dev/dashboard" })).status).toBe(404);
    expect(statements.join(" ")).not.toContain("INSERT INTO traces");
  });
  it("starts configured OAuth with the correct callback and rejects an external return URL", async () => {
    env.GOOGLE_CLIENT_ID = "test-client-id";
    env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    const r = await request("/api/auth/sign-in/social", { provider: "google", callbackURL: "https://oassis.dev/dashboard" });
    expect(r.status).toBe(200);
    const data = await r.json() as { url: string };
    const url = new URL(data.url);
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://oassis.dev/api/auth/callback/google");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect((await request("/api/auth/sign-in/social", { provider: "google", callbackURL: "https://evil.example" })).status).toBe(403);
    const page = await (await request("/login")).text();
    expect(page).not.toContain('data-provider="google" aria-disabled="true"');
  });
  async function googleCallback(emailVerified: boolean) {
    env.GOOGLE_CLIENT_ID = "oauth-test-client";
    env.GOOGLE_CLIENT_SECRET = "oauth-test-secret";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "test-google-key", alg: "RS256", use: "sig" };
    const token = await new SignJWT({ email: credentials.email, email_verified: emailVerified, name: "Google profile" })
      .setProtectedHeader({ alg: "RS256", kid: "test-google-key" }).setIssuer("https://accounts.google.com")
      .setAudience(env.GOOGLE_CLIENT_ID).setSubject("google-subject-1").setIssuedAt().setExpirationTime("5m").sign(privateKey);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "test-access-token", token_type: "Bearer", expires_in: 3600, id_token: token });
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
      throw new Error("Unexpected test network request: " + url);
    });
    const start = await request("/api/auth/sign-in/social", { provider: "google", callbackURL: "https://oassis.dev/dashboard", errorCallbackURL: "https://oassis.dev/login" });
    expect(start.status).toBe(200);
    const data = await start.json() as { url: string };
    const state = new URL(data.url).searchParams.get("state")!;
    const cookies = (start.headers as any).getSetCookie().map((s: string) => s.split(";")[0]).join("; ");
    return request("/api/auth/callback/google?code=test-code&state=" + encodeURIComponent(state), undefined, { cookie: cookies });
  }
  function seedGithub(verified: boolean) {
    const now = new Date().toISOString();
    sqlite.prepare('INSERT INTO site_user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
      .run("existing-user", "GitHub profile", credentials.email, verified ? 1 : 0, now, now);
    sqlite.prepare('INSERT INTO site_account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
      .run("github-account", "github-subject-1", "github", "existing-user", now, now);
  }
  it("links verified Google to the existing verified GitHub user without duplicating the user", async () => {
    seedGithub(true);
    const callback = await googleCallback(true);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("https://oassis.dev/dashboard");
    expect(sqlite.prepare("SELECT count(*) n FROM site_user").get().n).toBe(1);
    const accounts = sqlite.prepare("SELECT providerId,userId FROM site_account ORDER BY providerId").all();
    expect(accounts).toEqual([{ providerId: "github", userId: "existing-user" }, { providerId: "google", userId: "existing-user" }]);
    const cookie = (callback.headers as any).getSetCookie().map((s: string) => s.split(";")[0]).join("; ");
    const session = await (await request("/api/auth/get-session", undefined, { cookie })).json() as any;
    expect(session.user.id).toBe("existing-user");
    expect(statements.join(" ")).not.toContain("INSERT INTO traces");
  });
  it("does not link Google to an existing unverified email", async () => {
    seedGithub(false);
    const callback = await googleCallback(true);
    expect(callback.headers.get("location")).toBe("https://oassis.dev/login?error=account_not_linked");
    expect(sqlite.prepare("SELECT count(*) n FROM site_account").get().n).toBe(1);
    expect(sqlite.prepare("SELECT count(*) n FROM site_session").get().n).toBe(0);
  });
  it("does not trust an unverified Google email even when the existing GitHub email is verified", async () => {
    seedGithub(true);
    const callback = await googleCallback(false);
    expect(callback.headers.get("location")).toBe("https://oassis.dev/login?error=account_not_linked");
    expect(sqlite.prepare("SELECT count(*) n FROM site_account").get().n).toBe(1);
    expect(sqlite.prepare("SELECT count(*) n FROM site_session").get().n).toBe(0);
  });
  it("displays the real OAuth linking error even for old duplicate error parameters", () => {
    const html = authPage(false, { google: true, github: true });
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1]!;
    const error = { textContent: "", hidden: true, scrollIntoView() {} };
    runInNewContext(script, {
      URLSearchParams, location: { search: "?error=oauth&error=account_not_linked" },
      localStorage: { getItem() { return null; } },
      document: {
        getElementById(id: string) { return id === "error" ? error : { addEventListener() {} }; },
        querySelector() { return null; }, querySelectorAll() { return []; },
      },
    });
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain("both email addresses are verified");
    expect(html).toContain("errorCallbackURL:'https://oassis.dev/login'");
    expect(html).not.toContain("errorCallbackURL:'https://oassis.dev/login?error=oauth'");
  });
  it("shows the full account profile and saves only the signed-in user's display name", async () => {
    const first = await request("/api/auth/sign-up/email", credentials);
    const cookie = first.headers.get("set-cookie")!.split(";")[0]!;
    await request("/api/auth/sign-up/email", { ...credentials, email: "another@example.com", name: "Another user" });
    const updated = await request("/api/auth/update-user", { name: '<script>alert("test")</script>' }, { cookie });
    expect(updated.status).toBe(200);
    const dashboard = await request("/dashboard", undefined, { cookie });
    const html = await dashboard.text();
    expect(html).toContain('class="workspace"');
    expect(html).toContain('aria-label="Account navigation"');
    expect(html).toContain('id="profile-form"');
    expect(html).toContain("Sign-in methods");
    expect(html).toContain("Email and password");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("test")</script>');
    expect(html).not.toContain("another@example.com");
    expect(sqlite.prepare("SELECT name FROM site_user WHERE email=?").get("another@example.com").name).toBe("Another user");
    expect(statements.join(" ")).not.toContain("INSERT INTO traces");
    const anonymous = await request("/api/auth/update-user", { name: "Intruder" });
    expect(anonymous.status).toBe(401);
  });
  it("limits password guessing without changing MCP quotas", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 6; i++) last = await request("/api/auth/sign-in/email", credentials);
    expect(last!.status).toBe(429);
  });
});
