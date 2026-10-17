import { betterAuth } from "better-auth";
import type { Hono } from "hono";
import type { Env } from "./types";
import { authPage } from "./site-auth-page";
import { dashboardPage } from "./site-dashboard";

/** Website accounts are independent of the MCP, x402 and private console identities. */
export function createSiteAuth(env: Env) {
  return betterAuth({
    appName: "Oassis",
    baseURL: "https://oassis.dev",
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    database: env.BILLING,
    trustedOrigins: ["https://oassis.dev"],
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {}),
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } } : {}),
    },
    user: { modelName: "site_user" },
    session: { modelName: "site_session", expiresIn: 7 * 24 * 3600, updateAge: 24 * 3600 },
    account: { modelName: "site_account", encryptOAuthTokens: true, accountLinking: { enabled: true, requireLocalEmailVerified: true, trustedProviders: [] } },
    verification: { modelName: "site_verification" },
    rateLimit: {
      enabled: true, storage: "database", modelName: "site_rate_limit", window: 60, max: 60,
      customRules: { "/sign-in/email": { window: 60, max: 5 }, "/sign-up/email": { window: 60, max: 5 } },
    },
    advanced: {
      cookiePrefix: "oassis", useSecureCookies: true,
      disableOriginCheck: false, disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" },
    },
  });
}

export function mountSiteAuth(app: Hono<{ Bindings: Env }>): void {
  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    const authRoute = url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/");
    const page = ["/login", "/signup", "/dashboard"].includes(url.pathname);
    if (!authRoute && !page) return next();
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    if (url.hostname !== "oassis.dev" || url.protocol !== "https:") return c.notFound();
    if (!c.env.AUTH_SECRET) return c.json({ error: "Website authentication is not configured yet." }, 503);
    if (authRoute && !["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("origin") !== "https://oassis.dev") {
      return c.json({ error: "Untrusted authentication origin." }, 403);
    }
    const auth = createSiteAuth(c.env);
    if (authRoute) return auth.handler(c.req.raw);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.body(null, 405);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (url.pathname === "/dashboard") {
      if (!session) return c.redirect("/login", 303);
      const accounts = await auth.api.listUserAccounts({ headers: c.req.raw.headers });
      return c.html(dashboardPage({
        name: session.user.name, email: session.user.email,
        emailVerified: session.user.emailVerified, createdAt: session.user.createdAt,
        sessionExpiresAt: session.session.expiresAt,
        providers: accounts.map(account => account.providerId),
      }));
    }
    if (session) return c.redirect("/dashboard", 303);
    return c.html(authPage(url.pathname === "/signup", {
      google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
      github: !!(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET),
    }));
  });
}
